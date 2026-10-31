import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "@/lib/session-store/store";
import type { UsabilityReport } from "@/types";

const getRunDetails = vi.fn();
const evaluateSession = vi.fn();
const getTinyFish = vi.fn();

vi.mock("@/lib/tinyfish/client", () => ({
  cancelRun: vi.fn(),
  getRunDetails,
  getTinyFish,
  MissingApiKeyError: class MissingApiKeyError extends Error {},
}));

vi.mock("@/lib/evaluator", () => ({
  evaluateSession,
  buildFallbackReport: vi.fn(),
}));

const report = (sessionId: string): UsabilityReport => ({
  version: 2,
  sessionId,
  generatedAt: "2026-10-31T10:00:00.000Z",
  method: "EVIDENCE_SUMMARY",
  methodNote: "Recorded evidence",
  taskOutcome: "REPORTED_COMPLETE",
  outcomeRationale: "The task was completed.",
  summary: "A report was generated.",
  nextAction: "Review the recorded journey.",
  checkpoints: [],
  journey: {
    completeness: "NONE",
    completenessNote: "No steps recorded.",
    endedEarly: false,
    steps: [],
    patterns: [],
  },
  findings: [],
  technicalBlockers: [],
  evidence: [],
  urlsVisited: [],
  limitations: [],
  structuredResultValid: true,
});

describe("provider status reconciliation", () => {
  beforeEach(() => {
    getRunDetails.mockReset();
    evaluateSession.mockReset();
  });

  it("turns a provider-completed RUNNING session into a report exactly once", async () => {
    const session = sessionStore.create({
      websiteUrl: "https://example.com/",
      persona: { id: "p", description: "A traveller" },
      goal: "Find an option",
      successCriteria: ["Find one option"],
    });
    sessionStore.transition(session.id, "STARTING");
    sessionStore.transition(session.id, "RUNNING", (s) => {
      s.providerRunId = "run-completed";
    });

    getRunDetails.mockResolvedValue({
      run_id: "run-completed",
      status: "COMPLETED",
      result: {
        task_outcome: "completed",
        outcome_summary: "Found one option",
        checkpoints: [],
        actions: [],
        obstacles: [],
        urls_visited: [],
      },
      error: null,
      streaming_url: null,
      finished_at: "2026-10-31T10:00:00.000Z",
      steps: [
        {
          id: "step-1",
          timestamp: "2026-10-31T09:59:59.000Z",
          status: "COMPLETED",
          action: "Found one option",
          screenshot: "https://example.com/step-1.png",
          duration: "1s",
        },
      ],
    });
    evaluateSession.mockResolvedValue(report(session.id));

    const { reconcileSessionRun } = await import("@/lib/tinyfish/runner");
    await Promise.all([reconcileSessionRun(session.id), reconcileSessionRun(session.id)]);

    const completed = sessionStore.get(session.id)!;
    expect(completed.executionStatus).toBe("COMPLETED");
    expect(completed.report?.summary).toBe("A report was generated.");
    expect(completed.events.filter((event) => event.type === "RUN_COMPLETED")).toHaveLength(1);
    expect(completed.events.filter((event) => event.type === "REPORT_READY")).toHaveLength(1);
    // One reconciliation request plus one request to attach the recorded steps.
    expect(getRunDetails).toHaveBeenCalledTimes(2);
    expect(evaluateSession).toHaveBeenCalledTimes(1);
  });

  it("moves the live view to the new browser when TinyFish restarts the agent mid-run", async () => {
    const firstBrowser = "https://ip-1.tetra-data.production.tinyfish.io/tf-first/stream/0";
    const secondBrowser = "https://ip-2.tetra-data.production.tinyfish.io/tf-second/stream/0";
    const session = sessionStore.create({
      websiteUrl: "https://example.com/",
      persona: { id: "p", description: "A traveller" },
      goal: "Find an option",
      successCriteria: ["Find one option"],
    });
    sessionStore.transition(session.id, "STARTING");
    sessionStore.transition(session.id, "RUNNING", (s) => {
      s.providerRunId = "run-restarted";
      s.startedAt = "2026-10-31T10:18:11.000Z";
      s.streamingUrl = firstBrowser;
      s.liveViewStatus = "AVAILABLE";
    });

    const record = (streamingUrl: string) => ({
      run_id: "run-restarted",
      status: "RUNNING",
      result: null,
      error: null,
      streaming_url: streamingUrl,
      started_at: "2026-10-31T10:18:20Z",
      steps: [],
    });

    const { syncSessionRun } = await import("@/lib/tinyfish/runner");
    await syncSessionRun(session.id, record(secondBrowser));

    let current = sessionStore.get(session.id)!;
    expect(current.executionStatus).toBe("RUNNING");
    expect(current.streamingUrl).toBe(secondBrowser);
    expect(current.liveViewStatus).toBe("AVAILABLE");
    const switches = current.events.filter((event) => event.type === "LIVE_VIEW_AVAILABLE");
    expect(switches).toHaveLength(1);
    expect(switches[0].tone).toBe("notice");

    // Re-reading the same record, or a lagging one that still names the old
    // browser, must not add events or switch back.
    await syncSessionRun(session.id, record(secondBrowser));
    await syncSessionRun(session.id, record(firstBrowser));
    current = sessionStore.get(session.id)!;
    expect(current.streamingUrl).toBe(secondBrowser);
    expect(current.events.filter((event) => event.type === "LIVE_VIEW_AVAILABLE")).toHaveLength(1);
  });
});

describe("when TinyFish's live stream ends early", () => {
  const definition = {
    websiteUrl: "https://example.com/",
    persona: { id: "p", description: "A traveller" },
    goal: "Find an option",
    successCriteria: ["Find one option"],
  };
  const step = (n: number, action: string, status = "RUNNING") => ({
    id: `step-${n}`,
    timestamp: `2026-10-31T10:40:0${n}Z`,
    status,
    action,
    screenshot: `https://example.com/${n}.png`,
    duration: "1s",
  });
  const streamOf = (events: (() => unknown)[]) =>
    getTinyFish.mockReturnValue({
      agent: {
        stream: async () =>
          (async function* () {
            for (const next of events) yield next();
          })(),
      },
    });
  const progress = (id: string) =>
    sessionStore
      .get(id)!
      .events.filter((event) => event.type === "AGENT_PROGRESS")
      .map((event) => event.description);

  beforeEach(() => {
    getRunDetails.mockReset();
    evaluateSession.mockReset();
    getTinyFish.mockReset();
  });

  it("carries on from the run record without a warning on the timeline", async () => {
    const session = sessionStore.create(definition);
    const run = { run_id: "run-dropped", timestamp: "2026-10-31T10:40:00Z" };
    streamOf([
      () => ({ type: "STARTED", ...run }),
      () => ({ type: "PROGRESS", ...run, purpose: "Open the calendar" }),
      () => {
        throw new Error("terminated");
      },
    ]);
    getRunDetails.mockResolvedValue({
      run_id: "run-dropped",
      status: "COMPLETED",
      result: null,
      error: null,
      streaming_url: null,
      steps: [step(1, "Open the calendar"), step(2, "Pick 11 December"), step(3, "Task completed", "COMPLETED")],
    });
    evaluateSession.mockResolvedValue(report(session.id));

    const { startSessionRun } = await import("@/lib/tinyfish/runner");
    startSessionRun(session.id);
    await vi.waitFor(() => expect(sessionStore.get(session.id)!.executionStatus).toBe("COMPLETED"));

    const types = sessionStore.get(session.id)!.events.map((event) => event.type);
    expect(types).not.toContain("CONNECTION_INTERRUPTED");
    expect(types).not.toContain("CONNECTION_RECOVERED");
    // The agent's last step, seen only in the run record, still reaches the timeline.
    expect(progress(session.id)).toEqual(["Open the calendar", "Pick 11 December"]);
  });

  it("doesn't repeat a step the run record already added when the stream delivers it late", async () => {
    const session = sessionStore.create(definition);
    const run = { run_id: "run-late", timestamp: "2026-10-31T10:40:00Z" };
    streamOf([
      () => ({ type: "STARTED", ...run }),
      () => ({ type: "PROGRESS", ...run, purpose: "Open the calendar" }),
      () => {
        // While the stream was quiet, an open page filled this step in from the run record.
        sessionStore.appendEvent(session.id, { type: "AGENT_PROGRESS", description: "Pick 11 December", source: "provider" });
        return { type: "PROGRESS", ...run, purpose: "Pick 11 December" };
      },
      () => ({ type: "COMPLETE", ...run, status: "COMPLETED", result: null, error: null }),
    ]);
    getRunDetails.mockResolvedValue({
      run_id: "run-late",
      status: "COMPLETED",
      result: null,
      error: null,
      streaming_url: null,
      steps: [step(1, "Open the calendar"), step(2, "Pick 11 December")],
    });
    evaluateSession.mockResolvedValue(report(session.id));

    const { startSessionRun } = await import("@/lib/tinyfish/runner");
    startSessionRun(session.id);
    await vi.waitFor(() => expect(sessionStore.get(session.id)!.executionStatus).toBe("COMPLETED"));

    expect(progress(session.id)).toEqual(["Open the calendar", "Pick 11 December"]);
  });
});
