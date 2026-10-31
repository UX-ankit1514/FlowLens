import { randomUUID } from "node:crypto";
import type { RunDetails } from "./client";
import { mapRunError } from "./errors";
import type { ExecutionStatus, StepEvidence, TestDefinition, TestSession } from "@/types";

/**
 * Rebuilds a FlowLens session from a TinyFish run record (GET /v1/runs/:id).
 *
 * Used to reopen an earlier run in the current report format. Only what
 * TinyFish stored is used: the goal FlowLens sent (persona, task and criteria
 * are parsed back out of it), the step record with screenshots, the final
 * result and any error. TinyFish doesn't keep the live PROGRESS events, so the
 * session has none; the journey timeline is built from the step record.
 */
export function sessionFromRunRecord(details: RunDetails): TestSession {
  const definition = parseFlowLensGoal(details.goal ?? "");
  if (!definition) {
    throw new Error("This run wasn't started by FlowLens, so its persona, goal and success criteria can't be recovered.");
  }
  const id = randomUUID();
  const status: ExecutionStatus =
    details.status === "COMPLETED" ? "COMPLETED" : details.status === "CANCELLED" ? "CANCELLED" : "FAILED";
  const createdAt = details.created_at ?? details.started_at ?? new Date().toISOString();

  return {
    id,
    definition: { ...definition, id },
    providerRunId: details.run_id,
    executionStatus: status,
    createdAt,
    startedAt: details.started_at ?? undefined,
    finishedAt: details.finished_at ?? undefined,
    events: [
      {
        id: "E1",
        sequence: 1,
        timestamp: createdAt,
        type: "SESSION_CREATED",
        description: "Reopened from TinyFish's run record. Live progress events aren't stored by TinyFish, so the timeline uses the step record.",
        source: "flowlens",
        tone: "neutral",
      },
    ],
    rawResult: details,
    providerStatus: details.status,
    error: status === "FAILED" ? mapRunError(details.error ?? null) : undefined,
    liveViewStatus: "ENDED",
    steps: mapRunSteps(details.steps),
    notes: [],
    cancelRequested: false,
  };
}

export function mapRunSteps(steps: RunDetails["steps"]): StepEvidence[] {
  return steps.map((step, index) => ({
    ref: `S${index + 1}`,
    stepId: step.id,
    timestamp: step.timestamp ?? undefined,
    action: step.action ?? "",
    status: step.status ?? undefined,
    duration: step.duration ?? undefined,
    hasScreenshot: Boolean(step.screenshot),
  }));
}

/** Parses the goal text produced by buildAgentGoal back into a test definition. */
export function parseFlowLensGoal(goal: string): Omit<TestDefinition, "id"> | undefined {
  const persona = between(goal, /PERSONA[^\n]*:\n"""\n/, /\n"""/);
  const task = between(goal, /USER GOAL:\n"""\n/, /\n"""/);
  const criteriaBlock = between(goal, /SUCCESS CRITERIA[^\n]*:\n/, /\n\s*\n/);
  if (!persona || !task || !criteriaBlock) return undefined;
  const successCriteria = criteriaBlock
    .split("\n")
    .map((line) => /^\s*\d+\.\s+(.*)$/.exec(line)?.[1]?.trim())
    .filter((c): c is string => Boolean(c));
  const url = /^Navigate to (https?:\/\/\S+) to complete the goal/i.exec(goal)?.[1] ?? /https?:\/\/[^\s"']+/.exec(goal)?.[0];
  if (!url || successCriteria.length === 0) return undefined;
  return {
    websiteUrl: url,
    persona: { id: randomUUID(), description: persona },
    goal: task,
    successCriteria,
  };
}

function between(text: string, start: RegExp, end: RegExp): string | undefined {
  const s = start.exec(text);
  if (!s) return undefined;
  const rest = text.slice(s.index + s[0].length);
  const e = end.exec(rest);
  return (e ? rest.slice(0, e.index) : rest).trim() || undefined;
}
