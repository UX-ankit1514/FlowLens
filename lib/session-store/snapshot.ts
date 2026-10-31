import type { RecentSessionSummary, TestSession } from "@/types";

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

export function recentSummaryOf(s: TestSession): RecentSessionSummary {
  return {
    id: s.id,
    title: s.definition.sessionName || s.definition.goal,
    websiteUrl: s.definition.websiteUrl,
    goal: s.definition.goal,
    executionStatus: s.executionStatus,
    taskOutcome: s.taskOutcome,
    createdAt: s.createdAt,
    finishedAt: s.finishedAt,
    hasReport: Boolean(s.report),
    eventCount: s.events.length,
    stepCount: s.steps.length,
  };
}
