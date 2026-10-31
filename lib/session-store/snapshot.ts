import type { TestSession } from "@/types";

/** Lightweight live state sent over SSE on connect and after every change. */
export function snapshotOf(s: TestSession) {
  return {
    executionStatus: s.executionStatus,
    taskOutcome: s.taskOutcome,
    providerRunId: s.providerRunId,
    streamingUrl: s.streamingUrl,
    liveViewStatus: s.liveViewStatus,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    cancelRequested: s.cancelRequested,
    error: s.error,
    hasReport: Boolean(s.report),
    notes: s.notes,
    eventCount: s.events.length,
  };
}

export type SessionSnapshot = ReturnType<typeof snapshotOf>;
