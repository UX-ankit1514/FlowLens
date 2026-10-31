import { parseAgentObservations, type AgentObservations, type AgentObstacle } from "@/lib/tinyfish/output-schema";
import type {
  Checkpoint,
  CheckpointStatus,
  FindingCategory,
  Recommendation,
  Severity,
  TaskOutcome,
  TestBlocker,
  TestSession,
  UsabilityReport,
  UXFinding,
} from "@/types";
import { buildEvidenceIndex, obstacleLabel } from "./evidence";

/**
 * Evidence summary: a deterministic, rule-based report assembled only from
 * what TinyFish recorded. It is always produced, and it is the base that any
 * AI interpretation builds on. It never claims to be an AI analysis.
 */

export const LIMITATION_AGENT =
  "This session describes an AI agent's interaction with the website. Findings are preliminary and should be validated with real users where appropriate.";

/** Obstacles that stop the test itself — test limitations, not usability verdicts. */
const BLOCKER_KINDS = new Set([
  "login_required",
  "captcha_or_bot_protection",
  "site_unreachable",
  "irreversible_step_required",
]);

const CATEGORY_BY_KIND: Record<string, FindingCategory> = {
  error_or_broken_page: "BROKEN_JOURNEY",
  action_failed: "BROKEN_JOURNEY",
  information_not_found: "MISSING_INFORMATION",
  unclear_navigation: "CONFUSING_FLOW",
  unexpected_step: "POTENTIAL_FRICTION",
  repeated_attempts: "POTENTIAL_FRICTION",
  other: "POTENTIAL_FRICTION",
};

export function getObservations(session: TestSession): { data?: AgentObservations; reason?: string } {
  const raw = session.rawResult as { result?: unknown } | undefined;
  if (!raw) return { reason: "No result was received from TinyFish." };
  const parsed = parseAgentObservations(raw.result);
  return parsed.ok ? { data: parsed.data } : { reason: parsed.reason };
}

const STATUS_MAP: Record<string, CheckpointStatus> = {
  passed: "PASSED",
  failed: "FAILED",
  blocked: "BLOCKED",
  not_verified: "NOT_VERIFIED",
};

/** Designer's criteria are the source of truth; agent reports attach by position. */
export function buildCheckpoints(criteria: string[], observations?: AgentObservations): Checkpoint[] {
  return criteria.map((description, index) => {
    const reported = observations?.checkpoints[index];
    if (!reported) {
      return {
        id: `C${index + 1}`,
        description,
        status: "NOT_VERIFIED",
        observation: observations ? "The agent did not report on this criterion." : undefined,
        evidenceRefs: [],
      };
    }
    return {
      id: `C${index + 1}`,
      description,
      status: STATUS_MAP[reported.status] ?? "NOT_VERIFIED",
      observation: reported.observation || undefined,
      pageUrl: reported.page_url,
      evidenceRefs: [`C${index + 1}`],
    };
  });
}

export function buildBlockers(observations?: AgentObservations): TestBlocker[] {
  if (!observations) return [];
  return observations.obstacles.flatMap((obstacle, i) =>
    BLOCKER_KINDS.has(obstacle.kind)
      ? [
          {
            id: `B${i + 1}`,
            kind: obstacleLabel(obstacle.kind),
            description: obstacle.description,
            pageUrl: obstacle.page_url,
            evidenceRefs: [`O${i + 1}`],
          },
        ]
      : [],
  );
}

type OutcomeInput = {
  executionStatus: TestSession["executionStatus"];
  observations?: AgentObservations;
  checkpoints: Checkpoint[];
  blockers: TestBlocker[];
};

const AGENT_OUTCOME_LABEL: Record<string, string> = {
  completed: "completed",
  partially_completed: "partially completed",
  blocked: "blocked",
  not_completed: "not completed",
};

/**
 * Task outcome is decided from the designer's success criteria, never from
 * the provider's execution status alone.
 */
export function deriveTaskOutcome({ executionStatus, observations, checkpoints, blockers }: OutcomeInput): {
  outcome: TaskOutcome;
  rationale: string;
} {
  if (executionStatus === "CANCELLED") {
    return { outcome: "INCONCLUSIVE", rationale: "The session was stopped before the agent finished, so the task can't be judged." };
  }
  if (executionStatus === "FAILED") {
    return {
      outcome: "INCONCLUSIVE",
      rationale: "The run ended with a technical failure, so no conclusion about the task can be drawn.",
    };
  }
  if (!observations) {
    return {
      outcome: "INCONCLUSIVE",
      rationale: "TinyFish didn't return a structured result that FlowLens could check against the success criteria.",
    };
  }

  const total = checkpoints.length;
  const count = (s: CheckpointStatus) => checkpoints.filter((c) => c.status === s).length;
  const passed = count("PASSED");
  const failed = count("FAILED");
  const blocked = count("BLOCKED");
  const agentSaid = AGENT_OUTCOME_LABEL[observations.task_outcome];
  const agentNote =
    observations.task_outcome === "completed" && passed < total
      ? ` The agent rated the task as ${agentSaid}, but not every criterion was confirmed.`
      : "";

  if (total > 0 && passed === total) {
    return { outcome: "COMPLETED", rationale: `All ${total} success ${plural(total, "criterion", "criteria")} were reported as met.` };
  }
  if (passed > 0) {
    return {
      outcome: "PARTIAL",
      rationale: `${passed} of ${total} success criteria were met.${agentNote}`,
    };
  }
  if (blockers.length > 0 || blocked > 0) {
    const what = blockers.length > 0 ? blockers.map((b) => b.kind.toLowerCase()).join(", ") : "an obstacle";
    return {
      outcome: "BLOCKED",
      rationale: `The agent was stopped by ${what} before it could meet the success criteria. This is a test limitation, not by itself a usability verdict.`,
    };
  }
  if (failed > 0) {
    return { outcome: "NOT_COMPLETED", rationale: `None of the ${total} success criteria were met.` };
  }
  return {
    outcome: "INCONCLUSIVE",
    rationale: `The agent didn't verify any of the success criteria.${agentNote}`,
  };
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

function severityFor(obstacle: AgentObstacle, checkpoints: Checkpoint[]): { severity: Severity; rationale: string } {
  const criticalMissed = checkpoints.some((c) => c.status === "FAILED" || c.status === "BLOCKED");
  if (obstacle.blocked_progress && criticalMissed) {
    return {
      severity: "HIGH",
      rationale: "The agent reported that this stopped its progress, and at least one success criterion was not met.",
    };
  }
  if (obstacle.blocked_progress) {
    return {
      severity: "MEDIUM",
      rationale: "The agent reported that this stopped its progress on this route, but the success criteria were not directly failed.",
    };
  }
  if (obstacle.kind === "repeated_attempts" || obstacle.kind === "action_failed") {
    return { severity: "MEDIUM", rationale: "A repeated or failed attempt affected progress without fully preventing it." };
  }
  return { severity: "LOW", rationale: "Reported as a complication that did not block progress." };
}

const TITLES: Record<FindingCategory, string> = {
  BROKEN_JOURNEY: "Step did not work",
  MISSING_INFORMATION: "Information not found during the test",
  CONFUSING_FLOW: "Unclear next step",
  POTENTIAL_FRICTION: "Extra effort in the journey",
};

function hostPath(url?: string): string {
  if (!url) return "this page";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

function ruleBasedRecommendation(category: FindingCategory, obstacle: AgentObstacle, goal: string): {
  hypothesis: string;
  recommendation: string;
} {
  const where = hostPath(obstacle.page_url);
  switch (category) {
    case "BROKEN_JOURNEY":
      return {
        hypothesis: "This step may be failing for visitors, or the agent may have hit a transient error.",
        recommendation: `Reproduce this step manually on ${where}. If it fails, fix the interaction before running further tests.`,
      };
    case "MISSING_INFORMATION":
      return {
        hypothesis: "The information may be missing, or present but hard to find from where the agent looked. It was not found during this test — that doesn't prove it doesn't exist.",
        recommendation: `Check whether this information exists on or near ${where}. If it does, review its placement and labelling, then validate with real users.`,
      };
    case "CONFUSING_FLOW":
      return {
        hypothesis: "The available options may not clearly signal the next step toward the goal.",
        recommendation: `Review the labels and hierarchy of the options on ${where} against the goal "${truncate(goal, 90)}", and validate with real users.`,
      };
    default:
      return {
        hypothesis: "This step may add effort to the journey.",
        recommendation: `Review whether this step on ${where} is necessary at this point in the journey, and validate with real users.`,
      };
  }
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildRuleBasedFindings(
  session: TestSession,
  observations: AgentObservations | undefined,
  checkpoints: Checkpoint[],
): UXFinding[] {
  if (!observations) return [];
  const findings: UXFinding[] = [];
  const goal = session.definition.goal;

  observations.obstacles.forEach((obstacle, i) => {
    const category = CATEGORY_BY_KIND[obstacle.kind];
    if (!category) return; // blockers are reported separately
    const { severity, rationale } = severityFor(obstacle, checkpoints);
    const { hypothesis, recommendation } = ruleBasedRecommendation(category, obstacle, goal);
    const relatedCheckpoints = obstacle.blocked_progress
      ? checkpoints.filter((c) => c.status === "FAILED" || c.status === "BLOCKED")
      : [];
    findings.push({
      id: `F${findings.length + 1}`,
      title: TITLES[category],
      category,
      severity,
      severityRationale: rationale,
      observation: obstacle.description || obstacleLabel(obstacle.kind),
      hypothesis,
      personaRelevance:
        relatedCheckpoints.length > 0
          ? `This affected ${relatedCheckpoints.map((c) => `“${truncate(c.description, 70)}”`).join(" and ")}, which defines success for this persona's goal.`
          : undefined,
      recommendation,
      evidenceRefs: [`O${i + 1}`, ...relatedCheckpoints.flatMap((c) => c.evidenceRefs)],
      pageUrl: obstacle.page_url,
      confidence: obstacle.kind === "other" || !obstacle.description ? "UNCERTAIN" : "VERIFIED",
      origin: "AGENT_REPORTED",
    });
  });

  // Failed actions the agent didn't also list as an obstacle on the same page.
  const obstaclePages = new Set(observations.obstacles.map((o) => o.page_url).filter(Boolean));
  observations.actions.forEach((action, i) => {
    if (action.result !== "failed" || (action.page_url && obstaclePages.has(action.page_url))) return;
    findings.push({
      id: `F${findings.length + 1}`,
      title: "Action did not succeed",
      category: "BROKEN_JOURNEY",
      severity: "MEDIUM",
      severityRationale: "The agent reported this action as failed; it did not report it as blocking.",
      observation: action.description,
      hypothesis: "The control may not respond as expected, or the agent may have used it incorrectly.",
      recommendation: `Try this action manually on ${hostPath(action.page_url)} to confirm whether it works.`,
      evidenceRefs: [`A${i + 1}`],
      pageUrl: action.page_url,
      confidence: "VERIFIED",
      origin: "AGENT_REPORTED",
    });
  });

  // Pattern: the same page visited three or more times (non-consecutively).
  const visits = new Map<string, number>();
  let previous: string | undefined;
  for (const url of observations.urls_visited) {
    const key = url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (key !== previous) visits.set(key, (visits.get(key) ?? 0) + 1);
    previous = key;
  }
  for (const [url, count] of visits) {
    if (count < 3) continue;
    findings.push({
      id: `F${findings.length + 1}`,
      title: "Returned to the same page several times",
      category: "POTENTIAL_FRICTION",
      severity: "LOW",
      severityRationale: "A navigation pattern inferred from the visited URLs; no obstacle was reported for it.",
      observation: `The agent visited ${hostPath(url)} ${count} times during the journey.`,
      hypothesis: "The agent may have been looking for a route forward from this page.",
      recommendation: `Review whether the next step is clear from ${hostPath(url)}.`,
      evidenceRefs: [],
      pageUrl: url,
      confidence: "INFERRED",
      origin: "PATTERN",
    });
  }

  return findings;
}

export function recommendationsFromFindings(findings: UXFinding[]): Recommendation[] {
  return findings.map((f, i) => ({
    id: `R${i + 1}`,
    findingId: f.id,
    observation: f.observation,
    hypothesis: f.hypothesis,
    recommendation: f.recommendation,
  }));
}

function buildLimitations(session: TestSession, extra: string[]): string[] {
  const limitations = [LIMITATION_AGENT];
  limitations.push(
    "The agent ran in a desktop cloud browser. Device, assistive-technology or accessibility needs described in the persona were not emulated.",
  );
  limitations.push(
    "The cloud browser runs from TinyFish's infrastructure, which may be in a different country from the persona. Location-dependent content (default origin, currency, prices, availability) can differ from what the persona would see, so check location-related findings manually.",
  );
  if (session.steps.some((s) => s.hasScreenshot)) {
    limitations.push("Screenshots are the step captures TinyFish recorded during this run; not every browser action has one.");
  } else {
    limitations.push("No screenshots were captured for this run. Evidence is limited to the timeline, URLs and agent reports.");
  }
  limitations.push("The live browser stream is not recorded by FlowLens and expires after the run.");
  limitations.push("Sessions are stored in memory on this computer and are cleared when FlowLens restarts.");
  return [...limitations, ...extra];
}

function summarize(hasObservations: boolean, findings: UXFinding[], blockers: TestBlocker[]): string {
  if (!hasObservations) {
    return "The agent's structured result couldn't be checked, so no findings were derived. The timeline and screenshots below show what was recorded.";
  }
  const parts: string[] = [];
  parts.push(
    findings.length
      ? `${findings.length} potential ${plural(findings.length, "issue", "issues")} recorded from the agent's observations.`
      : "The agent reported no usability obstacles on this journey.",
  );
  if (blockers.length) parts.push(`${blockers.length} test ${plural(blockers.length, "blocker", "blockers")} limited what could be observed.`);
  return parts.join(" ");
}

/** The evidence-only report for a completed run. */
export function buildEvidenceSummaryReport(session: TestSession, methodNote?: string): UsabilityReport {
  const { data: observations, reason } = getObservations(session);
  const checkpoints = buildCheckpoints(session.definition.successCriteria, observations);
  const blockers = buildBlockers(observations);
  const { outcome, rationale } = deriveTaskOutcome({
    executionStatus: session.executionStatus === "ANALYSING" ? "COMPLETED" : session.executionStatus,
    observations,
    checkpoints,
    blockers,
  });
  const findings = buildRuleBasedFindings(session, observations, checkpoints);
  const extra: string[] = [];
  if (!observations && reason) extra.push(reason);

  return {
    sessionId: session.id,
    generatedAt: new Date().toISOString(),
    method: "EVIDENCE_SUMMARY",
    methodNote:
      methodNote ??
      "Evidence summary: findings are assembled by fixed rules from what the browser agent reported. No AI interpretation was applied.",
    taskOutcome: outcome,
    outcomeRationale: rationale,
    summary: summarize(Boolean(observations), findings, blockers),
    agentSummary: observations?.outcome_summary || undefined,
    finalAnswer: observations?.final_answer,
    checkpoints,
    findings,
    blockers,
    recommendations: recommendationsFromFindings(findings),
    evidence: buildEvidenceIndex(session, observations),
    urlsVisited: observations?.urls_visited ?? [],
    limitations: buildLimitations(session, extra),
    structuredResultValid: Boolean(observations),
  };
}

/** Report for cancelled/failed sessions: what was observed, no verdicts. */
export function buildFallbackReport(session: TestSession, note: string): UsabilityReport {
  const report = buildEvidenceSummaryReport(session);
  const stopped = session.executionStatus === "CANCELLED" || session.executionStatus === "FAILED";
  return {
    ...report,
    // A stopped or failed run never yields findings or a task verdict.
    taskOutcome: stopped ? "INCONCLUSIVE" : report.taskOutcome,
    outcomeRationale: stopped ? note : report.outcomeRationale,
    findings: stopped ? [] : report.findings,
    recommendations: stopped ? [] : report.recommendations,
    summary: stopped ? "This session didn't finish, so no usability findings were produced. The recorded evidence is listed below." : report.summary,
    methodNote: stopped ? "Partial evidence only. The session did not finish, so no analysis was performed." : report.methodNote,
    limitations: stopped ? report.limitations : [...report.limitations, note],
  };
}
