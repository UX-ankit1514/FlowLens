import type { AgentObservations } from "@/lib/tinyfish/output-schema";
import type { JourneyStep, TechnicalBlocker, TechnicalBlockerKind, TestSession } from "@/types";
import { classifyTechnical, classifyTechnicalAll } from "./classify";
import { formatRefRanges, truncate } from "./text";

/**
 * Technical blockers: bot protection, proxy and network changes, agent or
 * run failures, and the test's own boundaries (sign-in, real transactions).
 * These describe the automated test environment. They are never turned into
 * usability findings or UI recommendations.
 */

const OBSTACLE_KIND: Record<string, TechnicalBlockerKind> = {
  captcha_or_bot_protection: "BOT_PROTECTION",
  site_unreachable: "SITE_UNREACHABLE",
  login_required: "LOGIN_REQUIRED",
  irreversible_step_required: "REAL_WORLD_ACTION",
  automation_environment: "AGENT_ENVIRONMENT",
};

const TITLE: Record<TechnicalBlockerKind, string> = {
  BOT_PROTECTION: "Bot protection challenged the agent",
  PROXY_OR_NETWORK: "Proxy or network change",
  AGENT_ENVIRONMENT: "Agent or run failure",
  SITE_UNREACHABLE: "Site couldn't be reached",
  LOGIN_REQUIRED: "Sign-in required (test boundary)",
  REAL_WORLD_ACTION: "Stopped before a real transaction (test boundary)",
};

const KIND_ORDER: TechnicalBlockerKind[] = [
  "AGENT_ENVIRONMENT",
  "BOT_PROTECTION",
  "PROXY_OR_NETWORK",
  "SITE_UNREACHABLE",
  "LOGIN_REQUIRED",
  "REAL_WORLD_ACTION",
];

type Signal = {
  kind: TechnicalBlockerKind;
  text: string;
  ref?: string;
  stepRef?: string;
  pageUrl?: string;
  blockedProgress?: boolean;
  /** Higher = better description of the blocker. */
  weight: number;
};

export type CriterionText = { id: string; status: string; observation?: string };

export function buildTechnicalBlockers(
  session: TestSession,
  observations: AgentObservations | undefined,
  steps: JourneyStep[],
  checkpoints: CriterionText[],
): TechnicalBlocker[] {
  const signals: Signal[] = [];

  observations?.obstacles.forEach((obstacle, i) => {
    const text = `${obstacle.summary ?? ""} ${obstacle.description}`;
    const declared = OBSTACLE_KIND[obstacle.kind];
    const kinds = [...new Set([...(declared ? [declared] : []), ...classifyTechnicalAll(text)])];
    for (const kind of kinds) {
      signals.push({
        kind,
        text: obstacle.description || obstacle.summary || "",
        ref: `O${i + 1}`,
        pageUrl: obstacle.page_url,
        blockedProgress: obstacle.blocked_progress,
        weight: kind === declared ? 3 : 2.5,
      });
    }
  });

  observations?.actions.forEach((action, i) => {
    for (const kind of classifyTechnicalAll(`${action.description} ${action.purpose ?? ""}`)) {
      signals.push({ kind, text: action.description, ref: `A${i + 1}`, pageUrl: action.page_url, weight: 2 });
    }
  });

  for (const step of steps) {
    if (!step.flags.some((f) => f.kind === "TECHNICAL")) continue;
    const kinds = classifyTechnicalAll(step.statedPurpose);
    const fallback = classifyTechnical(step.agentAction?.description) ?? "AGENT_ENVIRONMENT";
    for (const kind of kinds.length ? kinds : [fallback]) {
      signals.push({ kind, text: step.statedPurpose, stepRef: step.ref, weight: 1 });
    }
  }

  if (session.executionStatus === "FAILED" && session.error) {
    signals.push({
      kind: "AGENT_ENVIRONMENT",
      text: session.error.providerMessage ? `${session.error.message} (TinyFish: ${session.error.providerMessage})` : session.error.message,
      weight: 4,
      blockedProgress: true,
    });
  }

  const byKind = new Map<TechnicalBlockerKind, Signal[]>();
  for (const signal of signals) byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal]);

  const actionSteps = steps.filter((s) => !s.terminal);
  const lastUxStep = [...actionSteps].reverse().find((s) => !s.flags.some((f) => f.kind === "TECHNICAL"));

  return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind, index) => {
    const list = byKind.get(kind)!;
    const primary = [...list].sort((a, b) => b.weight - a.weight)[0];
    const stepRefs = [...new Set(list.flatMap((s) => (s.stepRef ? [s.stepRef] : [])))];
    const evidenceRefs = [...new Set(list.flatMap((s) => (s.ref ? [s.ref] : [])))];
    const affectsCriteria = checkpoints.filter((c) => classifyTechnical(c.observation) === kind).map((c) => c.id);

    const runFailed = session.executionStatus === "FAILED" && kind === "AGENT_ENVIRONMENT";
    const lastTechnicalIndex = stepRefs.length
      ? Math.max(...stepRefs.map((ref) => actionSteps.findIndex((s) => s.ref === ref)))
      : -1;
    const continuedAfter = lastTechnicalIndex >= 0 && lastUxStep ? actionSteps.indexOf(lastUxStep) > lastTechnicalIndex : false;
    const blockedProgress = list.some((s) => s.blockedProgress);
    const stoppedRun =
      runFailed ||
      (stepRefs.length > 0
        ? blockedProgress && !continuedAfter
        : blockedProgress && !checkpoints.some((c) => c.status === "PASSED"));

    return {
      id: `T${index + 1}`,
      kind,
      title: TITLE[kind],
      description: truncate(primary.text, 400),
      effect: describeEffect(kind, { runFailed, continuedAfter, stepRefs, affectsCriteria, stoppedRun, lastStepRef: actionSteps[actionSteps.length - 1]?.ref }),
      stoppedRun,
      stepRefs,
      evidenceRefs,
      affectsCriteria,
      pageUrl: list.find((s) => s.pageUrl && /^https?:\/\//i.test(s.pageUrl))?.pageUrl,
    };
  });
}

function describeEffect(
  kind: TechnicalBlockerKind,
  ctx: {
    runFailed: boolean;
    continuedAfter: boolean;
    stepRefs: string[];
    affectsCriteria: string[];
    stoppedRun: boolean;
    lastStepRef?: string;
  },
): string {
  const parts: string[] = [];
  if (ctx.runFailed) {
    parts.push(`The run ended with this error${ctx.lastStepRef ? ` after ${ctx.lastStepRef}` : ""}, so the journey wasn't finished.`);
  } else if (ctx.continuedAfter && ctx.stepRefs.length) {
    parts.push(`The agent continued after ${formatRefRanges(ctx.stepRefs)}.`);
  } else if (ctx.stoppedRun) {
    parts.push("It stopped the agent from going further.");
  }
  if (kind === "PROXY_OR_NETWORK") {
    parts.push(
      "The agent's network route changed, so later pages may show location-dependent content (currency, prices, availability) that differs from what the persona would see.",
    );
  }
  if (kind === "LOGIN_REQUIRED" || kind === "REAL_WORLD_ACTION") {
    parts.push("FlowLens agents don't sign in, pay or submit real data, so the journey beyond this point wasn't observed.");
  }
  if (ctx.affectsCriteria.length) {
    parts.push(`It limited what could be checked for ${ctx.affectsCriteria.join(", ")}.`);
  }
  parts.push("This reflects the automated test environment and isn't a usability finding.");
  return parts.join(" ");
}

/** Every evidence ref that belongs to a technical blocker (used to keep findings clean). */
export function technicalRefs(blockers: TechnicalBlocker[]): Set<string> {
  return new Set(blockers.flatMap((b) => [...b.evidenceRefs, ...b.stepRefs]));
}
