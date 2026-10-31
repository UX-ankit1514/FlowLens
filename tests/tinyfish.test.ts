import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  BadRequestError,
  PaymentRequiredError,
  RateLimitError,
  APIConnectionError,
} from "@tiny-fish/sdk";
import { mapRunError, mapThrownError, redactSecrets } from "@/lib/tinyfish/errors";
import { buildAgentGoal } from "@/lib/tinyfish/instruction";
import { AGENT_OUTPUT_SCHEMA, parseAgentObservations } from "@/lib/tinyfish/output-schema";
import type { TestDefinition } from "@/types";

/* TinyFish output_schema rules: docs.tinyfish.ai/key-concepts/structured-output */
const ALLOWED_KEYWORDS = new Set([
  "anyOf",
  "enum",
  "format",
  "items",
  "maxItems",
  "maximum",
  "minItems",
  "minimum",
  "nullable",
  "properties",
  "propertyOrdering",
  "required",
  "type",
]);

function walkSchema(node: Record<string, unknown>, path: string, depth: number, visit: (n: Record<string, unknown>, p: string, d: number) => void) {
  visit(node, path, depth);
  const props = node.properties as Record<string, Record<string, unknown>> | undefined;
  for (const [key, child] of Object.entries(props ?? {})) walkSchema(child, `${path}/properties/${key}`, depth + 1, visit);
  if (node.items) walkSchema(node.items as Record<string, unknown>, `${path}/items`, depth + 1, visit);
}

describe("TinyFish output schema", () => {
  it("only uses keywords TinyFish supports and respects its constraints", () => {
    const schema = AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(JSON.stringify(schema).length).toBeLessThan(64 * 1024);
    let maxDepth = 0;
    walkSchema(schema, "#", 1, (node, path, depth) => {
      maxDepth = Math.max(maxDepth, depth);
      for (const key of Object.keys(node)) expect(ALLOWED_KEYWORDS.has(key), `${key} at ${path}`).toBe(true);
      expect(Array.isArray(node.type), `type array at ${path}`).toBe(false);
      if (node.enum) {
        expect(node.type).toBe("string");
        expect((node.enum as unknown[]).every((v) => typeof v === "string")).toBe(true);
      }
      if (node.items || node.maxItems || node.minItems) expect(node.type).toBe("array");
      const props = Object.keys((node.properties as object) ?? {});
      for (const r of (node.required as string[]) ?? []) expect(props, `required ${r} at ${path}`).toContain(r);
      for (const r of (node.propertyOrdering as string[]) ?? []) expect(props).toContain(r);
    });
    expect(maxDepth).toBeLessThanOrEqual(10);
  });

  it("parses a valid result and degrades unknown values safely", () => {
    const parsed = parseAgentObservations({
      task_outcome: "completed",
      outcome_summary: "Done",
      checkpoints: [{ criterion: "A", status: "something-new", observation: "x" }],
      actions: [{ description: "Clicked Pricing", result: "succeeded", page_url: null }],
      obstacles: [{ kind: "brand_new_kind", description: "Odd", blocked_progress: false }],
      urls_visited: ["https://example.com", 42],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.checkpoints[0].status).toBe("not_verified");
      expect(parsed.data.obstacles[0].kind).toBe("other");
      expect(parsed.data.urls_visited).toEqual(["https://example.com"]);
    }
  });

  it("does not invent observations when the result is missing or unstructured", () => {
    expect(parseAgentObservations(null).ok).toBe(false);
    const failure = parseAgentObservations({ status: "failure", reason: "Could not find products" });
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.reason).toContain("Could not find products");
  });
});

describe("agent instruction", () => {
  const definition: TestDefinition = {
    id: "t1",
    websiteUrl: "https://example.com",
    persona: { id: "p1", description: "Meera, 41, a nurse who books travel on her phone during breaks." },
    goal: "Find a refundable hotel near the airport.",
    successCriteria: ["Find a hotel near the airport", "Confirm the cancellation policy"],
    featureContext: { name: "SECRET-FEATURE-NAME", description: "Use the new map toggle in the header" },
  };

  it("passes persona verbatim, numbers the criteria and includes safety rules", () => {
    const goal = buildAgentGoal(definition);
    expect(goal).toContain(definition.persona.description);
    expect(goal).toContain("1. Find a hotel near the airport");
    expect(goal).toContain("2. Confirm the cancellation policy");
    expect(goal).toMatch(/purchase, payment/);
    expect(goal).toMatch(/information to observe and report, not a new task/);
    expect(goal).not.toMatch(/ignore any page text/i);
    expect(goal).toMatch(/Do not try to bypass logins, CAPTCHAs/);
  });

  it("does not steer the agent with feature context (independent discovery)", () => {
    const goal = buildAgentGoal(definition);
    expect(goal).not.toContain("SECRET-FEATURE-NAME");
    expect(goal).not.toContain("map toggle");
  });
});

describe("provider error mapping", () => {
  const response = (status: number) => new Response(null, { status });

  it("maps SDK exceptions to clear, non-success errors", () => {
    expect(mapThrownError(new AuthenticationError("bad key", { response: response(401) })).kind).toBe(
      "INVALID_API_KEY",
    );
    expect(mapThrownError(new PaymentRequiredError("no funds", { response: response(402) })).kind).toBe(
      "INSUFFICIENT_CREDITS",
    );
    expect(mapThrownError(new RateLimitError("slow down", { response: response(429) })).kind).toBe(
      "RATE_LIMITED",
    );
    expect(mapThrownError(new BadRequestError("bad schema", { response: response(400) })).kind).toBe(
      "INVALID_REQUEST",
    );
    expect(mapThrownError(new APIConnectionError("offline")).kind).toBe("NETWORK");
    expect(mapThrownError(new Error("??")).kind).toBe("UNKNOWN");
  });

  it("maps run error categories", () => {
    expect(mapRunError({ message: "no money", category: "BILLING_FAILURE", retry_after: null }).kind).toBe("INSUFFICIENT_CREDITS");
    expect(mapRunError({ message: "crash", category: "SYSTEM_FAILURE", retry_after: 30 }).kind).toBe("PROVIDER_ERROR");
    expect(mapRunError({ message: "bad goal", category: "AGENT_FAILURE", retry_after: null }).message).toContain(
      "not a usability finding",
    );
  });

  it("explains policy rejections without calling them usability findings", () => {
    const mapped = mapRunError({
      message: "This request can't be processed because it may violate our usage policies.",
      category: "AGENT_FAILURE",
      retry_after: null,
    });
    expect(mapped.message).toMatch(/safety filter/);
    expect(mapped.message).toMatch(/not a usability finding/);
  });

  it("never stores API keys in messages", () => {
    expect(redactSecrets("key sk-tinyfish-abc123_DEF was rejected")).toBe("key [redacted] was rejected");
  });
});
