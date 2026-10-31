import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildAgentGoal } from "@/lib/tinyfish/instruction";
import type { UsabilityReport } from "@/types";

const getRunDetails = vi.fn();
const queue = vi.fn();
const evaluateSession = vi.fn();

vi.mock("@/lib/tinyfish/client", () => ({
  cancelRun: vi.fn(),
  getRunDetails,
  getTinyFish: vi.fn(() => ({ agent: { queue } })),
  listRuns: vi.fn(async () => []),
  MissingApiKeyError: class MissingApiKeyError extends Error {},
}));

vi.mock("@/lib/evaluator", () => ({
  evaluateSession,
  buildFallbackReport: vi.fn(() => undefined),
}));

const KEY_A = "sk-tinyfish-aaaaaaaaaaaaaaaaaaaa";
const KEY_B = "sk-tinyfish-bbbbbbbbbbbbbbbbbbbb";

const definition = {
  websiteUrl: "https://books.example.com/",
  persona: { id: "p", description: "A careful reader on a budget." },
  goal: "Find a mystery book under £20.",
  successCriteria: ["A mystery book under £20 is open", "Its price is visible"],
};

const report = (sessionId: string): UsabilityReport => ({
  version: 2,
  sessionId,
  generatedAt: "2026-10-31T10:00:00.000Z",
  method: "EVIDENCE_SUMMARY",
  methodNote: "Recorded evidence",
  taskOutcome: "REPORTED_COMPLETE",
  outcomeRationale: "The agent reported success.",
  summary: "Summary.",
  nextAction: "Next.",
  checkpoints: [],
  journey: { completeness: "STEP_LEVEL", completenessNote: "Steps.", endedEarly: false, steps: [], patterns: [] },
  findings: [],
  technicalBlockers: [],
  evidence: [],
  urlsVisited: [],
  limitations: [],
  structuredResultValid: true,
});

const runRecord = (runId: string, status: string, steps: string[]) => ({
  run_id: runId,
  status,
  goal: `Navigate to ${definition.websiteUrl} to complete the goal.\n\n${buildAgentGoal({ ...definition, id: "x" })}`,
  created_at: "2026-10-31T10:00:00.000Z",
  started_at: status === "PENDING" ? null : "2026-10-31T10:00:02.000Z",
  finished_at: null,
  streaming_url: status === "RUNNING" ? "https://live.tinyfish.example/stream" : null,
  result: status === "COMPLETED" ? { task_completed: true } : null,
  error: null,
  steps: steps.map((action, i) => ({
    id: `step-${i + 1}`,
    action,
    timestamp: `2026-10-31T10:00:${String(10 + i).padStart(2, "0")}.000Z`,
    screenshot: "x",
  })),
});

describe("API keys", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("prefers a header key, then the browser cookie, then the server key", async () => {
    const { resolveKeys } = await import("@/lib/keys");
    process.env.TINYFISH_API_KEY = "sk-server-key-123456";
    const cookies = { get: (name: string) => (name === "flowlens_tinyfish_key" ? { value: KEY_B } : undefined) };

    expect(resolveKeys(new Headers({ "x-tinyfish-api-key": KEY_A }), cookies)).toMatchObject({ tinyfish: KEY_A, tinyfishSource: "header" });
    expect(resolveKeys(new Headers({ authorization: `Bearer ${KEY_A}` }), cookies).tinyfishSource).toBe("header");
    expect(resolveKeys(new Headers(), cookies)).toMatchObject({ tinyfish: KEY_B, tinyfishSource: "browser" });
    expect(resolveKeys(new Headers())).toMatchObject({ tinyfish: "sk-server-key-123456", tinyfishSource: "server" });
    delete process.env.TINYFISH_API_KEY;
    expect(resolveKeys(new Headers({ "x-tinyfish-api-key": "short" })).tinyfish).toBeUndefined();
  });

  it("scopes sessions to the key that ran them on a hosted deployment", async () => {
    const { canAccess, ownerIdFor } = await import("@/lib/keys");
    const owner = ownerIdFor({ tinyfish: KEY_A });
    expect(owner).toMatch(/^k_[0-9a-f]{32}$/);
    expect(owner).not.toContain(KEY_A);

    process.env.FLOWLENS_MULTI_USER = "1";
    expect(canAccess({ ownerId: owner }, { tinyfish: KEY_A })).toBe(true);
    expect(canAccess({ ownerId: owner }, { tinyfish: KEY_B })).toBe(false);
    expect(canAccess({ ownerId: owner }, {})).toBe(false);
    expect(canAccess({}, { tinyfish: KEY_A })).toBe(false);
    delete process.env.FLOWLENS_MULTI_USER;
    delete process.env.VERCEL;
    expect(canAccess({}, {})).toBe(true);
  });
});

describe("hosted run following (poll mode)", () => {
  beforeEach(() => {
    getRunDetails.mockReset();
    queue.mockReset();
    evaluateSession.mockReset();
    process.env.FLOWLENS_RUN_MODE = "poll";
    process.env.FLOWLENS_MULTI_USER = "1";
  });
  afterEach(() => {
    delete process.env.FLOWLENS_RUN_MODE;
    delete process.env.FLOWLENS_MULTI_USER;
  });

  it("queues the run, uses its id as the session id, and follows the run record to a report", async () => {
    const runId = "11111111-2222-4333-8444-555555555555";
    queue.mockResolvedValue({ run_id: runId, error: null });
    const { startPolledRun, syncSessionRun } = await import("@/lib/tinyfish/runner");
    const { sessionStore } = await import("@/lib/session-store/store");

    const session = await startPolledRun(definition, { tinyfish: KEY_A }, "owner-a");
    expect(session.id).toBe(runId);
    expect(session.providerRunId).toBe(runId);
    expect(session.executionStatus).toBe("STARTING");

    getRunDetails.mockResolvedValueOnce(runRecord(runId, "RUNNING", ["Open the catalogue", "Choose Mystery"]));
    await syncSessionRun(runId);
    let current = sessionStore.get(runId)!;
    expect(current.executionStatus).toBe("RUNNING");
    expect(current.streamingUrl).toBe("https://live.tinyfish.example/stream");
    expect(current.events.filter((e) => e.type === "AGENT_PROGRESS").map((e) => e.description)).toEqual([
      "Open the catalogue",
      "Choose Mystery",
    ]);
    expect(getRunDetails).toHaveBeenCalledWith(runId, KEY_A);

    // Run finished: the last step is TinyFish's end marker, not an agent action.
    const done = runRecord(runId, "COMPLETED", ["Open the catalogue", "Choose Mystery", "Open a book", "Task completed"]);
    getRunDetails.mockResolvedValue(done);
    evaluateSession.mockResolvedValue(report(runId));
    await syncSessionRun(runId, done);
    current = sessionStore.get(runId)!;
    expect(current.events.filter((e) => e.type === "AGENT_PROGRESS")).toHaveLength(3);
    expect(current.executionStatus).toBe("COMPLETED");
    expect(current.report?.taskOutcome).toBe("REPORTED_COMPLETE");
    expect(evaluateSession).toHaveBeenCalledTimes(1);
    expect(evaluateSession.mock.calls[0][1]).toMatchObject({ tinyfish: KEY_A });
  });

  it("rebuilds an unknown session from the caller's own run record only", async () => {
    const runId = "99999999-2222-4333-8444-555555555555";
    const { loadSession } = await import("@/lib/sessions/service");
    const { ownerIdFor } = await import("@/lib/keys");

    getRunDetails.mockImplementation(async (id: string, key: string) => {
      if (key !== KEY_A) throw new Error("not found");
      return runRecord(id, "RUNNING", ["Open the catalogue"]);
    });

    expect(await loadSession(runId, { tinyfish: KEY_B })).toBeUndefined();
    const rebuilt = await loadSession(runId, { tinyfish: KEY_A });
    expect(rebuilt?.id).toBe(runId);
    expect(rebuilt?.definition.goal).toBe(definition.goal);
    expect(rebuilt?.definition.successCriteria).toEqual(definition.successCriteria);
    expect(rebuilt?.ownerId).toBe(ownerIdFor({ tinyfish: KEY_A }));
    // Someone else's key can't open it once it's held in memory either.
    expect(await loadSession(runId, { tinyfish: KEY_B })).toBeUndefined();
  });
});

describe("MCP endpoint", () => {
  const call = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/mcp/route");
    return POST(
      new NextRequest("https://flowlens.example/api/mcp", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      }),
    );
  };

  it("initializes and lists the FlowLens tools without a key", async () => {
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    const initBody = await init.json();
    expect(initBody.result.protocolVersion).toBe("2025-06-18");
    expect(initBody.result.serverInfo.name).toBe("flowlens");
    expect(initBody.result.capabilities.tools).toBeDefined();

    const note = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);

    const list = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "start_usability_test",
      "get_test_status",
      "get_test_report",
      "list_tests",
      "stop_test",
    ]);
  });

  it("asks for a TinyFish key before running anything", async () => {
    const saved = process.env.TINYFISH_API_KEY;
    delete process.env.TINYFISH_API_KEY;
    const res = await (
      await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_tests", arguments: {} } })
    ).json();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/TinyFish/);
    process.env.TINYFISH_API_KEY = saved;
  });

  it("validates test inputs and rejects requests from other websites", async () => {
    const res = await (
      await call(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "start_usability_test", arguments: { website_url: "http://10.0.0.1", persona: "p", goal: "g", success_criteria: ["c"] } },
        },
        { "x-tinyfish-api-key": KEY_A },
      )
    ).json();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/private network/);
    expect(queue).not.toHaveBeenCalled();

    const crossSite = await call({ jsonrpc: "2.0", id: 5, method: "tools/list" }, { origin: "https://evil.example" });
    expect(crossSite.status).toBe(403);
  });
});
