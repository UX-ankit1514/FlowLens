import type { AgentObservations } from "@/lib/tinyfish/output-schema";
import type { JourneyStep, JourneyTrace, StepFlag, TestSession } from "@/types";
import {
  actionFamily,
  classifyTechnical,
  hasErrorWording,
  hasRetryWording,
  inferActionType,
  interruptionNoun,
  isBacktrack,
  isDirectUrl,
  TECHNICAL_KIND_LABEL,
} from "./classify";
import { jaccard, overlap, tokenSet, intersectionSize, plural } from "./text";

/**
 * Builds the chronological journey trace from what TinyFish actually exposed.
 *
 * Source of truth, in order of preference:
 *   1. TinyFish's recorded steps (GET /v1/runs/:id): one entry per agent step
 *      with the agent's stated purpose, a timestamp, a duration and usually a
 *      screenshot. TinyFish does not record a page URL or result per step.
 *   2. The live PROGRESS events received during the run (same purposes, no
 *      screenshots or durations), when the step record wasn't available.
 *
 * Nothing is added that TinyFish didn't expose. Per-step page URLs and results
 * are attached only from the agent's own end-of-run report (matched by
 * wording) or from the step that follows, and they are labelled as such.
 */
export function buildJourneyTrace(session: TestSession, observations?: AgentObservations): Omit<JourneyTrace, "patterns"> {
  const endedEarly = session.executionStatus === "CANCELLED" || session.executionStatus === "FAILED";
  const origin = parseTime(session.startedAt) ?? parseTime(session.steps[0]?.timestamp) ?? parseTime(session.createdAt);

  let steps: JourneyStep[];
  let completeness: JourneyTrace["completeness"];

  if (session.steps.length > 0) {
    completeness = "STEP_LEVEL";
    const eventByStep = new Map(
      session.events.filter((e) => e.evidenceRef).map((e) => [e.evidenceRef as string, e.id]),
    );
    steps = session.steps.map((step, index) => {
      const isLast = index === session.steps.length - 1;
      const status = (step.status ?? "").toUpperCase();
      const terminal =
        isLast && (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED")
          ? (status as JourneyStep["terminal"])
          : undefined;
      const at = parseTime(step.timestamp);
      return {
        ref: step.ref,
        number: index + 1,
        stepId: step.stepId,
        timestamp: step.timestamp,
        elapsedMs: at !== undefined && origin !== undefined ? Math.max(0, at - origin) : undefined,
        duration: step.duration,
        statedPurpose: step.action.trim(),
        actionType: terminal ? "OTHER" : inferActionType(step.action),
        terminal,
        hasScreenshot: step.hasScreenshot,
        eventRef: eventByStep.get(step.ref),
        flags: [],
      } satisfies JourneyStep;
    });
  } else {
    const progress = session.events.filter((e) => e.source === "provider" && e.type === "AGENT_PROGRESS");
    completeness = progress.length > 0 ? "PROGRESS_ONLY" : "NONE";
    steps = progress.map((event, index) => {
      const at = parseTime(event.timestamp);
      return {
        ref: event.id,
        number: index + 1,
        timestamp: event.timestamp,
        elapsedMs: at !== undefined && origin !== undefined ? Math.max(0, at - origin) : undefined,
        statedPurpose: event.description.trim(),
        actionType: inferActionType(event.description),
        hasScreenshot: false,
        eventRef: event.id,
        flags: [],
      } satisfies JourneyStep;
    });
  }

  if (observations) attachAgentActions(steps, observations);
  flagSteps(steps);
  attachResults(steps, session);

  const last = steps[steps.length - 1];
  const finished = parseTime(session.finishedAt) ?? parseTime(last?.timestamp);

  return {
    completeness,
    completenessNote: completenessNote(completeness, steps, endedEarly),
    endedEarly,
    startedAt: origin !== undefined ? new Date(origin).toISOString() : undefined,
    durationMs: origin !== undefined && finished !== undefined ? Math.max(0, finished - origin) : undefined,
    steps,
  };
}

function parseTime(value?: string): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

function completenessNote(completeness: JourneyTrace["completeness"], steps: JourneyStep[], endedEarly: boolean): string {
  const ended = endedEarly ? " The run ended early, so the trace stops where the agent stopped." : "";
  if (completeness === "NONE") {
    return `TinyFish didn't record any agent steps for this session.${ended}`;
  }
  if (completeness === "PROGRESS_ONLY") {
    return `Incomplete trace: TinyFish's step record wasn't available, so this shows only the live progress messages received during the run — no screenshots or durations.${ended}`;
  }
  const actionSteps = steps.filter((s) => !s.terminal);
  const withoutShot = actionSteps.filter((s) => !s.hasScreenshot).length;
  const shots =
    withoutShot === 0
      ? "and a screenshot"
      : withoutShot === actionSteps.length
        ? "but no screenshots"
        : `and a screenshot for ${actionSteps.length - withoutShot} of ${actionSteps.length}`;
  return `${actionSteps.length} ${plural(actionSteps.length, "step", "steps")} recorded by TinyFish, each with the agent's stated purpose, time ${shots}. TinyFish doesn't record the page or result of each step; where shown, they come from the agent's end-of-run report or from the step that followed.${ended}`;
}

/* ------------------------------------------------------------------------ */
/* Matching the agent's end-of-run action list to recorded steps            */
/* ------------------------------------------------------------------------ */

const MATCH_THRESHOLD = 0.6;

/**
 * Aligns the agent's reported actions (A#) with recorded steps in order,
 * maximising total wording overlap. A pair counts only if at least two
 * meaningful words and 60% of the step's words appear in the action.
 */
function attachAgentActions(steps: JourneyStep[], observations: AgentObservations) {
  const actions = observations.actions;
  const candidates = steps.filter((s) => !s.terminal);
  if (actions.length === 0 || candidates.length === 0) return;

  const stepTokens = candidates.map((s) => tokenSet(s.statedPurpose));
  const actionTokens = actions.map((a) => tokenSet(`${a.description} ${a.purpose ?? ""}`));
  const score = (ai: number, si: number) => {
    const shared = intersectionSize(actionTokens[ai], stepTokens[si]);
    if (shared < 2 || stepTokens[si].size === 0) return 0;
    const s = shared / stepTokens[si].size;
    return s >= MATCH_THRESHOLD ? s : 0;
  };

  // Weighted longest-common-subsequence over (actions × steps).
  const A = actions.length;
  const S = candidates.length;
  const best: number[][] = Array.from({ length: A + 1 }, () => new Array<number>(S + 1).fill(0));
  for (let a = A - 1; a >= 0; a--) {
    for (let s = S - 1; s >= 0; s--) {
      const pair = score(a, s);
      best[a][s] = Math.max(best[a + 1][s], best[a][s + 1], pair > 0 ? pair + best[a + 1][s + 1] : 0);
    }
  }
  let a = 0;
  let s = 0;
  while (a < A && s < S) {
    const pair = score(a, s);
    if (pair > 0 && Math.abs(best[a][s] - (pair + best[a + 1][s + 1])) < 1e-9) {
      const action = actions[a];
      candidates[s].agentAction = {
        ref: `A${a + 1}`,
        description: action.description,
        purpose: action.purpose,
        pageUrl: action.page_url,
        result: action.result,
      };
      if (!candidates[s].statedPurpose && action.purpose) candidates[s].inferredPurpose = action.purpose;
      a++;
      s++;
    } else if (best[a + 1][s] >= best[a][s + 1]) {
      a++;
    } else {
      s++;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Per-step flags                                                            */
/* ------------------------------------------------------------------------ */

const RETRY_WINDOW = 4;

function isRepeatOf(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  if (Math.min(a.size, b.size) < 3) return jaccard(a, b) === 1 && a.size >= 2;
  return overlap(a, b) >= 0.8 && jaccard(a, b) >= 0.34;
}

function flagSteps(steps: JourneyStep[]) {
  const tokenSets = steps.map((s) => tokenSet(s.statedPurpose));
  steps.forEach((step, i) => {
    if (step.terminal) {
      if (step.terminal === "FAILED") {
        const kind = classifyTechnical(step.statedPurpose) ?? "AGENT_ENVIRONMENT";
        step.flags.push({ kind: "TECHNICAL", note: `${TECHNICAL_KIND_LABEL[kind]}: the run ended with an error`, relatedRefs: [] });
      }
      return;
    }
    const purpose = step.statedPurpose;
    const flags: StepFlag[] = [];

    const technical = classifyTechnical(purpose) ?? classifyTechnical(step.agentAction?.description);
    if (technical) {
      // Automation steps are reported under Technical blockers, not as journey behaviour.
      step.flags.push({ kind: "TECHNICAL", note: `${TECHNICAL_KIND_LABEL[technical]} — about the test environment, not the design`, relatedRefs: [] });
      return;
    }

    const interruption = interruptionNoun(purpose);
    if (interruption) {
      flags.push({ kind: "INTERRUPTION", note: `Cleared a ${interruption} out of the way`, relatedRefs: [] });
    }

    if (!interruption) {
      let earlier = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (steps[j].terminal) continue;
        // A repeat on the far side of a bot check or proxy change was likely
        // caused by it, so it isn't counted as journey behaviour.
        if (steps[j].flags.some((f) => f.kind === "TECHNICAL")) break;
        if (steps[j].flags.some((f) => f.kind === "INTERRUPTION")) continue;
        if (actionFamily(steps[j].actionType) !== actionFamily(step.actionType)) continue;
        if (isRepeatOf(tokenSets[i], tokenSets[j])) {
          earlier = j;
          break;
        }
      }
      if (earlier >= 0 && i - earlier <= RETRY_WINDOW) {
        flags.push({ kind: "RETRY", note: `Another attempt at ${steps[earlier].ref}`, relatedRefs: [steps[earlier].ref] });
      } else if (earlier >= 0) {
        flags.push({ kind: "REPEAT", note: `Same stated purpose as ${steps[earlier].ref}`, relatedRefs: [steps[earlier].ref] });
      } else if (hasRetryWording(purpose)) {
        flags.push({ kind: "RETRY", note: "Described by the agent as another attempt", relatedRefs: [] });
      }
    }

    if (isBacktrack(purpose)) flags.push({ kind: "BACKTRACK", note: "Went back to an earlier page", relatedRefs: [] });
    if (hasErrorWording(purpose)) flags.push({ kind: "ERROR", note: "The agent mentions an error or something not working", relatedRefs: [] });
    if (isDirectUrl(purpose)) {
      flags.push({ kind: "DIRECT_URL", note: "Went to a page by URL rather than through the site's navigation", relatedRefs: [] });
    }
    if (step.actionType === "WAIT") flags.push({ kind: "WAIT", note: "Waited for the page", relatedRefs: [] });

    step.flags.push(...flags);
  });
}

/* ------------------------------------------------------------------------ */
/* Per-step results                                                          */
/* ------------------------------------------------------------------------ */

const ACTION_RESULT_TEXT: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  no_visible_effect: "No visible effect",
};

function attachResults(steps: JourneyStep[], session: TestSession) {
  steps.forEach((step, i) => {
    if (step.terminal) {
      step.result = {
        source: "RUN_RECORD",
        text:
          step.terminal === "COMPLETED"
            ? "TinyFish marked the run complete. This doesn't by itself mean the task succeeded."
            : step.terminal === "FAILED"
              ? `The run failed: ${session.error?.providerMessage ?? step.statedPurpose}`
              : "The run was cancelled.",
      };
      return;
    }
    if (step.agentAction) {
      step.result = {
        source: "AGENT_REPORT",
        text: `${ACTION_RESULT_TEXT[step.agentAction.result] ?? step.agentAction.result} (agent's report ${step.agentAction.ref})`,
      };
      return;
    }
    const next = steps[i + 1];
    if (!next || next.terminal) return;
    const retry = next.flags.find((f) => (f.kind === "RETRY" || f.kind === "REPEAT") && f.relatedRefs.includes(step.ref));
    if (retry) {
      step.result = { source: "NEXT_STEP", text: `The agent tried this again in ${next.ref}` };
    } else if (next.flags.some((f) => f.kind === "BACKTRACK")) {
      step.result = { source: "NEXT_STEP", text: `The agent went back next (${next.ref})` };
    } else if (next.flags.some((f) => f.kind === "ERROR")) {
      step.result = { source: "NEXT_STEP", text: `The next step mentions an error (${next.ref})` };
    }
  });
}
