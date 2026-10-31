import "server-only";
import { z } from "zod";
import type { ApiKeys } from "@/lib/keys";
import { LIMITS } from "@/lib/schemas/test-input";
import { sessionStore } from "@/lib/session-store/store";
import { isTerminal } from "@/lib/session-store/transitions";
import { listRecentSessions, loadSession, NO_TINYFISH_KEY, startTest, StartTestError } from "@/lib/sessions/service";
import { refreshSessionRun, requestCancel, sessionWork } from "@/lib/tinyfish/runner";
import { recentText, reportText, statusText } from "./format";

/**
 * A small, stateless MCP server (Streamable HTTP, JSON responses) so Claude
 * Code, Codex and other MCP clients can run FlowLens tests and read reports.
 * Each request carries the caller's own TinyFish key in a header.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_VERSION = "0.2.0";
const MAX_WAIT_SECONDS = 45;
const POLL_MS = 2_500;

const INSTRUCTIONS = `FlowLens runs preliminary usability tests: a TinyFish browser agent attempts a goal on a real website as a persona, and FlowLens reports what happened step by step.
Workflow: call start_usability_test, then call get_test_status repeatedly (it waits up to 45 s per call) until the status is completed, failed or stopped, then call get_test_report for the full journey, findings and evidence.
Tests take 1–8 minutes and spend the user's TinyFish balance, so only start one when the user asks. Ask the user for a persona, a goal and success criteria if they haven't given them.
Technical blockers (bot protection, proxies, agent errors) are not usability findings. Never present agent results as real-user research.`;

type JsonRpcId = string | number | null;
type JsonRpcMessage = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: unknown };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

export type McpContext = {
  keys: ApiKeys;
  baseUrl: string;
  /** Work that should keep running after the response (report generation). */
  defer: (work: Promise<unknown>) => void;
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

const testId = z.string().trim().regex(/^[a-zA-Z0-9-]{8,64}$/, "Use the test_id returned by start_usability_test.");

const TOOLS = [
  {
    name: "start_usability_test",
    title: "Start a usability test",
    description:
      "Starts a real usability test: a TinyFish browser agent attempts the goal on the website, using the persona as context. Takes 1–8 minutes and uses the connected TinyFish balance. Returns a test_id; follow it with get_test_status.",
    inputSchema: {
      type: "object",
      properties: {
        website_url: { type: "string", description: "Public page to start from, e.g. https://example.com" },
        persona: {
          type: "string",
          description: "Who the visitor is, as the designer wrote it (role, familiarity, needs, constraints).",
          maxLength: LIMITS.persona,
        },
        goal: { type: "string", description: "The outcome the visitor wants, not a list of clicks.", maxLength: LIMITS.goal },
        success_criteria: {
          type: "array",
          description: "Observable checks that mean the goal was achieved, one per item.",
          items: { type: "string", maxLength: LIMITS.criterion },
          minItems: 1,
          maxItems: LIMITS.criteriaCount,
        },
        test_name: { type: "string", description: "Optional short name for the test.", maxLength: LIMITS.sessionName },
      },
      required: ["website_url", "persona", "goal", "success_criteria"],
      additionalProperties: false,
    },
    annotations: { title: "Start a usability test", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "get_test_status",
    title: "Follow a test",
    description:
      "Returns a test's progress (latest agent steps, live view link). Waits up to wait_seconds for it to finish. When finished, includes the verdict summary.",
    inputSchema: {
      type: "object",
      properties: {
        test_id: { type: "string" },
        wait_seconds: {
          type: "integer",
          minimum: 0,
          maximum: MAX_WAIT_SECONDS,
          description: `How long to wait for the test to finish before answering (default 30, max ${MAX_WAIT_SECONDS}).`,
        },
      },
      required: ["test_id"],
      additionalProperties: false,
    },
    annotations: { title: "Follow a test", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_test_report",
    title: "Read a test report",
    description:
      "Returns the full report of a finished test: verdict, success criteria with verification, step-by-step journey timeline, journey patterns, UX findings, technical blockers and human validation status.",
    inputSchema: {
      type: "object",
      properties: { test_id: { type: "string" } },
      required: ["test_id"],
      additionalProperties: false,
    },
    annotations: { title: "Read a test report", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_tests",
    title: "List recent tests",
    description: "Lists recent FlowLens tests run with this TinyFish key, newest first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." } },
      additionalProperties: false,
    },
    annotations: { title: "List recent tests", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "stop_test",
    title: "Stop a test",
    description: "Stops a running test and cancels its TinyFish run.",
    inputSchema: {
      type: "object",
      properties: { test_id: { type: "string" } },
      required: ["test_id"],
      additionalProperties: false,
    },
    annotations: { title: "Stop a test", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
];

const startArgs = z.object({
  website_url: z.string(),
  persona: z.string(),
  goal: z.string(),
  success_criteria: z.array(z.string()),
  test_name: z.string().optional(),
});
const statusArgs = z.object({ test_id: testId, wait_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional() });
const idArgs = z.object({ test_id: testId });
const listArgs = z.object({ limit: z.number().int().min(1).max(50).optional() });

const NOT_FOUND = "No FlowLens test with this id for the connected TinyFish key.";

async function callTool(name: string, rawArgs: unknown, ctx: McpContext): Promise<ToolResult> {
  if (!ctx.keys.tinyfish) return text(NO_TINYFISH_KEY, true);
  const args = rawArgs ?? {};

  switch (name) {
    case "start_usability_test": {
      const parsed = startArgs.safeParse(args);
      if (!parsed.success) return text(`Invalid arguments: ${parsed.error.issues[0]?.message ?? "check the inputs"}.`, true);
      try {
        const session = await startTest(
          {
            websiteUrl: parsed.data.website_url,
            persona: parsed.data.persona,
            goal: parsed.data.goal,
            successCriteria: parsed.data.success_criteria,
            sessionName: parsed.data.test_name,
          },
          ctx.keys,
        );
        return text(
          [
            `Started test ${session.id}.`,
            `test_id: ${session.id}`,
            `Watch it live in FlowLens: ${ctx.baseUrl}/sessions/${session.id}`,
            "Next: call get_test_status with this test_id until it finishes (usually 1–8 minutes).",
          ].join("\n"),
        );
      } catch (error) {
        if (error instanceof StartTestError) {
          const fields = error.fieldErrors ? Object.entries(error.fieldErrors).map(([k, v]) => `${k}: ${v}`).join("; ") : "";
          return text(fields ? `${error.message} ${fields}` : error.message, true);
        }
        throw error;
      }
    }

    case "get_test_status": {
      const parsed = statusArgs.safeParse(args);
      if (!parsed.success) return text(parsed.error.issues[0]?.message ?? "Invalid test_id.", true);
      const id = parsed.data.test_id;
      const waitMs = (parsed.data.wait_seconds ?? 30) * 1000;
      const deadline = Date.now() + waitMs;
      let session = await loadSession(id, ctx.keys, { waitMs: Math.min(waitMs, 8_000) });
      if (!session) return text(NOT_FOUND, true);
      while (!isTerminal(session.executionStatus) && Date.now() < deadline) {
        await refreshSessionRun(id);
        await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
        session = sessionStore.get(id) ?? session;
      }
      if (!isTerminal(session.executionStatus)) ctx.defer(sessionWork(id));
      return text(statusText(session, ctx.baseUrl));
    }

    case "get_test_report": {
      const parsed = idArgs.safeParse(args);
      if (!parsed.success) return text(parsed.error.issues[0]?.message ?? "Invalid test_id.", true);
      const session = await loadSession(parsed.data.test_id, ctx.keys, { waitMs: 20_000 });
      if (!session) return text(NOT_FOUND, true);
      if (!isTerminal(session.executionStatus)) ctx.defer(sessionWork(session.id));
      return text(reportText(session, ctx.baseUrl));
    }

    case "list_tests": {
      const parsed = listArgs.safeParse(args);
      if (!parsed.success) return text("limit must be between 1 and 50.", true);
      const items = await listRecentSessions(ctx.keys, parsed.data.limit ?? 10);
      return text(recentText(items, ctx.baseUrl));
    }

    case "stop_test": {
      const parsed = idArgs.safeParse(args);
      if (!parsed.success) return text(parsed.error.issues[0]?.message ?? "Invalid test_id.", true);
      const session = await loadSession(parsed.data.test_id, ctx.keys);
      if (!session) return text(NOT_FOUND, true);
      const outcome = await requestCancel(session.id);
      return text(outcome.message, !outcome.accepted);
    }

    default:
      return text(`Unknown tool: ${name}`, true);
  }
}

function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[1];
}

/** Handles one JSON-RPC message. Returns undefined for notifications. */
export async function handleMcpMessage(message: JsonRpcMessage, ctx: McpContext): Promise<JsonRpcResponse | undefined> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? undefined : { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } };
  }
  if (isNotification) return undefined;

  const params = (message.params ?? {}) as Record<string, unknown>;
  try {
    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: negotiateVersion(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "flowlens", title: "FlowLens", version: SERVER_VERSION },
            instructions: INSTRUCTIONS,
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!TOOLS.some((t) => t.name === name)) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } };
        }
        return { jsonrpc: "2.0", id, result: await callTool(name, params.arguments, ctx) };
      }
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };
      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } };
    }
  } catch (error) {
    console.error("[flowlens] MCP request failed", error);
    if (message.method === "tools/call") {
      return { jsonrpc: "2.0", id, result: text("FlowLens hit an unexpected error. Try again.", true) };
    }
    return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
  }
}
