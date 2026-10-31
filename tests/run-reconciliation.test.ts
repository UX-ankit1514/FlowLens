import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "@/lib/session-store/store";
import type { UsabilityReport } from "@/types";

const getRunDetails = vi.fn();
const evaluateSession = vi.fn();

vi.mock("@/lib/tinyfish/client", () => ({
  cancelRun: vi.fn(),
  getRunDetails,
  getTinyFish: vi.fn(),
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
});
