import { parseAgentObservations, type AgentObservations, type AgentObstacle } from "@/lib/tinyfish/output-schema";
import { CONTRADICTION_WORDING, TECHNICAL_ANY, TECHNICAL_KIND_LABEL, classifyTechnical } from "@/lib/journey/classify";
import { detectPatterns, stepsMentioning, TECHNICAL_OBSTACLES } from "@/lib/journey/patterns";
import { buildTechnicalBlockers } from "@/lib/journey/technical";
import { formatRefRanges, intersectionSize, plural, quoteAround, shortTitle, tokenSet, truncate } from "@/lib/journey/text";
import { buildJourneyTrace } from "@/lib/journey/trace";
import type {
  Checkpoint,
  CheckpointStatus,
  JourneyPattern,
  JourneyStep,
  TaskOutcome,
  TechnicalBlocker,
  TestSession,
  UsabilityReport,
  UXFinding,
} from "@/types";
import { buildEvidenceIndex, obstacleLabel } from "./evidence";

/**
 * Evidence summary: a deterministic report assembled only from what TinyFish
 * recorded and what the agent reported. It is always produced, and it is the
 * base that any AI interpretation builds on. It never claims to be an AI
 * analysis, and it never treats "the provider finished the run" as success.
 */

/** Bump when the report shape changes; saved reports from older versions are rebuilt. */
export const REPORT_VERSION = 2;

export const LIMITATION_AGENT =
  "This session describes an AI agent's interaction with the website, not a person's. Findings are preliminary until they're checked with real research participants.";

export function getObservations(session: TestSession): { data?: AgentObservations; reason?: string } {
  const raw = session.rawResult as { result?: unknown } | undefined;
  if (!raw) return { reason: "No result was received from TinyFish." };
  const parsed = parseAgentObservations(raw.result);
  return parsed.ok ? { data: parsed.data } : { reason: parsed.reason };
}

/* ------------------------------------------------------------------------ */
/* Checkpoints and result verification                                       */
/* ------------------------------------------------------------------------ */

const STATUS_MAP: Record<string, CheckpointStatus> = {
  passed: "PASSED",
  failed: "FAILED",
  blocked: "BLOCKED",
  not_verified: "NOT_VERIFIED",
};

/**
 * Designer's criteria are the source of truth; agent reports attach by
 * position. Each "passed" is then checked against the agent's own words: a
 * note that mentions bot protection or a failure can't count as confirmed.
 */
export function buildCheckpoints(criteria: string[], observations?: AgentObservations): Checkpoint[] {
  return criteria.map((description, index) => {
    const id = `C${index + 1}`;
    const reported = observations?.checkpoints[index];
    if (!reported) {
      return {
        id,
        description,
        status: "NOT_VERIFIED",
        observation: observations ? "The agent did not report on this criterion." : undefined,
        evidenceRefs: [],
        verification: "NOT_APPLICABLE",
        verificationRefs: [],
      };
    }
    const status = STATUS_MAP[reported.status] ?? "NOT_VERIFIED";
    const observation = reported.observation || undefined;
    return {
      id,
      description,
      status,
      observation,
      pageUrl: reported.page_url,
      evidenceRefs: [id],
      ...verifyByRules(id, status, observation),
    };
  });
}

function verifyByRules(
  id: string,
  status: CheckpointStatus,
  observation: string | undefined,
): Pick<Checkpoint, "verification" | "verificationNote" | "verificationRefs"> {
  if (status !== "PASSED") return { verification: "NOT_APPLICABLE", verificationRefs: [] };
  const text = observation ?? "";
  const technical = classifyTechnical(text);
  if (technical) {
    return {
      verification: "LIMITED",
      verificationNote: `${TECHNICAL_KIND_LABEL[technical]} affected this criterion. The agent's note says: “${quoteAround(text, TECHNICAL_ANY) ?? truncate(text, 160)}”`,
      verificationRefs: [id],
    };
  }
  if (CONTRADICTION_WORDING.test(text)) {
    return {
      verification: "CONTRADICTED",
      verificationNote: `Reported as met, but the agent's own note says: “${quoteAround(text, CONTRADICTION_WORDING) ?? truncate(text, 160)}”`,
      verificationRefs: [id],
    };
  }
  return {
    verification: "AGENT_REPORTED",
    verificationNote: text
      ? "Only the agent's own report supports this. It hasn't been confirmed against a screenshot."
      : "The agent marked this as met without describing what it saw.",
    verificationRefs: [id],
  };
}

/* ------------------------------------------------------------------------ */
/* Task outcome                                                              */
/* ------------------------------------------------------------------------ */

type OutcomeInput = {
  executionStatus: TestSession["executionStatus"];
  observations?: AgentObservations;
  checkpoints: Checkpoint[];
  blockers: TechnicalBlocker[];
};

/**
 * Task outcome is decided from the designer's success criteria and how well
 * each "passed" is backed by evidence, never from the provider's execution
 * status alone.
 */
export function deriveTaskOutcome({ executionStatus, observations, checkpoints, blockers }: OutcomeInput): {
  outcome: TaskOutcome;
  rationale: string;
} {
  if (executionStatus === "CANCELLED") {
    return { outcome: "NOT_VERIFIED", rationale: "The session was stopped before the agent finished, so the task can't be judged." };
  }
  if (executionStatus === "FAILED") {
    return {
      outcome: "NOT_VERIFIED",
      rationale: "The run ended with a technical failure, so no conclusion about the task can be drawn.",
    };
  }
  if (!observations) {
    return {
      outcome: "NOT_VERIFIED",
      rationale: "TinyFish didn't return a structured result that FlowLens could check against the success criteria.",
    };
  }

  const total = checkpoints.length;
  const passed = checkpoints.filter((c) => c.status === "PASSED");
  const failed = checkpoints.filter((c) => c.status === "FAILED");
  const blockedCps = checkpoints.filter((c) => c.status === "BLOCKED");
  const contradicted = passed.filter((c) => c.verification === "CONTRADICTED");
  const limited = passed.filter((c) => c.verification === "LIMITED");
  const confirmed = passed.filter((c) => c.verification === "CONFIRMED");
  const caveats = [
    contradicted.length ? `the evidence conflicts with ${ids(contradicted)}` : "",
    limited.length ? `a technical blocker affected ${ids(limited)}` : "",
  ].filter(Boolean);
  const caveatText = caveats.length ? ` However, ${caveats.join(" and ")}.` : "";

  if (total > 0 && passed.length === total) {
    if (confirmed.length === total) {
      return {
        outcome: "VERIFIED_COMPLETE",
        rationale: `All ${total} success ${plural(total, "criterion was", "criteria were")} met, and each was confirmed in a step screenshot.`,
      };
    }
    if (contradicted.length > 0) {
      return {
        outcome: "NOT_VERIFIED",
        rationale: `The agent reported all ${total} ${plural(total, "criterion", "criteria")} as met, but the evidence conflicts with ${ids(contradicted)}, so success isn't confirmed.`,
      };
    }
    const unconfirmed = total - confirmed.length;
    return {
      outcome: "REPORTED_COMPLETE",
      rationale: `The agent reported all ${total} ${plural(total, "criterion", "criteria")} as met. ${
        confirmed.length > 0 ? `${unconfirmed} of them ${plural(unconfirmed, "wasn't", "weren't")}` : plural(total, "It wasn't", "They weren't")
      } independently confirmed.${limited.length ? ` A technical blocker affected ${ids(limited)}.` : ""}`,
    };
  }
  if (passed.length > 0) {
    return { outcome: "PARTIAL", rationale: `${passed.length} of ${total} success criteria were reported as met.${caveatText}` };
  }
  const stopping = blockers.filter((b) => b.stoppedRun);
  if (stopping.length > 0 || blockedCps.length > 0) {
    const what = stopping.length > 0 ? stopping.map((b) => b.title.toLowerCase().replace(/ \(test boundary\)$/, "")).join(" and ") : "an obstacle";
    return {
      outcome: "BLOCKED",
      rationale: `The agent was stopped by ${what} before it could meet any success criterion. This is a test limitation, not by itself a usability verdict.`,
    };
  }
  if (failed.length > 0) {
    return { outcome: "NOT_COMPLETED", rationale: `None of the ${total} success criteria were met.` };
  }
  return { outcome: "NOT_VERIFIED", rationale: "The agent didn't confirm any of the success criteria." };
}

function ids(list: Array<{ id: string }>): string {
  return list.map((c) => c.id).join(", ");
}

/* ------------------------------------------------------------------------ */
/* UX findings (rules)                                                       */
/* ------------------------------------------------------------------------ */

const FUNCTIONAL_KINDS = new Set(["error_or_broken_page", "action_failed"]);

const DEFAULT_TITLE: Record<string, string> = {
  error_or_broken_page: "Error or broken page",
  action_failed: "An action didn't work",
  information_not_found: "Needed information not found",
  unclear_navigation: "Unclear next step",
  unexpected_step: "Unexpected step in the journey",
  repeated_attempts: "Needed several attempts",
  other: "Obstacle in the journey",
};

const LOCATION_SENSITIVE = /\b(price|prices|pricing|fare|fares|cost|currency|location|region|country|availability|available in|ship(?:ping)? to|deliver(?:y)? to|language|tax|vat)\b/i;

export const LOCATION_CAVEAT =
  "The cloud browser may not be in the persona's location, so prices, currency and availability can differ from what the persona would see. Check this from the persona's location before acting on it.";

export function hostPath(url?: string): string {
  if (!url) return "the page where it happened";
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "the page where it happened";
  }
}

function samePage(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.replace(/[#?].*$/, "").replace(/\/$/, "") === b.replace(/[#?].*$/, "").replace(/\/$/, "");
}

function criteriaAffectedBy(obstacle: AgentObstacle, checkpoints: Checkpoint[]): Checkpoint[] {
  const unmet = checkpoints.filter((c) => c.status === "FAILED" || c.status === "BLOCKED");
  const words = tokenSet(`${obstacle.summary ?? ""} ${obstacle.description} ${obstacle.expected ?? ""}`);
  const matches = unmet.filter(
    (c) => samePage(c.pageUrl, obstacle.page_url) || intersectionSize(tokenSet(`${c.description} ${c.observation ?? ""}`), words) >= 2,
  );
  if (matches.length === 0 && obstacle.blocked_progress && unmet.length === 1) return unmet;
  return matches;
}

function stepsText(refs: string[]): string {
  return refs.length ? ` (${formatRefRanges(refs.slice(0, 6))}${refs.length > 6 ? "…" : ""})` : "";
}

function designerActionFor(
  obstacle: AgentObstacle,
  where: string,
  stepRefs: string[],
  affected: Checkpoint[],
  goal: string,
): string {
  const summary = truncate(obstacle.summary || obstacle.description, 110);
  const at = stepsText(stepRefs);
  switch (obstacle.kind) {
    case "information_not_found": {
      const looked = obstacle.looked_in
        ? ` The agent looked in ${truncate(obstacle.looked_in, 120)}${at}.`
        : stepRefs.length
          ? ` Related steps: ${formatRefRanges(stepRefs.slice(0, 6))}${stepRefs.length > 6 ? "…" : ""}.`
          : "";
      const check = obstacle.expected
        ? `Check whether “${truncate(obstacle.expected, 90)}” is visible on ${where} to a real visitor.`
        : `Open ${where} as a visitor and check what the agent reported: “${shortTitle(obstacle.summary || obstacle.description)}”.`;
      return `${check}${looked} If it reproduces, show the information where the agent looked; if it doesn't, the test environment may have caused it.`;
    }
    case "unclear_navigation":
      return `On ${where}, review the choices the agent faced${at}: ${summary}. Check whether the labels make the route to “${truncate(goal, 70)}” obvious.`;
    case "unexpected_step":
      return `Check whether the step the agent hit on ${where}${at} is needed at that point in the journey: ${summary}.`;
    case "repeated_attempts":
      return `Repeat the attempts${at} on ${where} yourself and check what feedback the page gives after each one.`;
    case "error_or_broken_page":
    case "action_failed":
      return `Reproduce this on ${where}${at}: ${summary}. If it fails for a visitor too, fix it${affected.length ? ` — it stands in the way of ${ids(affected)}` : ""}.`;
    default:
      return `Review what happened on ${where}${at}: ${summary}.`;
  }
}

function impactFor(obstacle: AgentObstacle, affected: Checkpoint[]): string | undefined {
  if (affected.length > 0) {
    return `It stood between the persona and ${affected
      .map((c) => `${c.id} (“${truncate(c.description, 70)}”)`)
      .join(" and ")}, which ${plural(affected.length, "wasn't", "weren't")} met.`;
  }
  if (obstacle.blocked_progress) return "The agent reported that it stopped progress on this route toward the goal.";
  return undefined;
}

function sentenceCase(text: string): string {
  const t = text.trim().replace(/[.]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function buildRuleBasedFindings(
  session: TestSession,
  observations: AgentObservations | undefined,
  checkpoints: Checkpoint[],
  steps: JourneyStep[],
): UXFinding[] {
  if (!observations) return [];
  const findings: UXFinding[] = [];
  const goal = session.definition.goal;
  const covered = new Set<string>();

  observations.obstacles.forEach((obstacle, i) => {
    const text = `${obstacle.summary ?? ""} ${obstacle.description}`;
    // Bot protection, proxies, sign-in walls etc. are technical blockers, never findings.
    if (TECHNICAL_OBSTACLES.has(obstacle.kind) || classifyTechnical(text)) return;
    const affected = criteriaAffectedBy(obstacle, checkpoints);
    affected.forEach((c) => covered.add(c.id));
    const title = obstacle.summary
      ? sentenceCase(truncate(obstacle.summary, 80))
      : obstacle.description
        ? sentenceCase(shortTitle(obstacle.description))
        : DEFAULT_TITLE[obstacle.kind] ?? obstacleLabel(obstacle.kind);
    const stepRefs = stepsMentioning(steps, `${title} ${obstacle.expected ?? ""}`, session.definition.websiteUrl);
    findings.push({
      id: "",
      kind: FUNCTIONAL_KINDS.has(obstacle.kind) ? "FUNCTIONAL_FAILURE" : "USABILITY_HYPOTHESIS",
      title,
      whatHappened: obstacle.description || obstacleLabel(obstacle.kind),
      stepRefs,
      pageUrl: obstacle.page_url,
      personaImpact: impactFor(obstacle, affected),
      designerAction: designerActionFor(obstacle, hostPath(obstacle.page_url), stepRefs, affected, goal),
      caveat: LOCATION_SENSITIVE.test(`${text} ${obstacle.expected ?? ""}`) ? LOCATION_CAVEAT : undefined,
      evidenceRefs: [`O${i + 1}`, ...affected.map((c) => c.id)],
      affectsCriteria: affected.map((c) => c.id),
      origin: "RULES",
    });
  });

  // Failed actions the agent didn't also describe as an obstacle on the same page.
  observations.actions.forEach((action, i) => {
    if (action.result !== "failed") return;
    if (classifyTechnical(`${action.description} ${action.purpose ?? ""}`)) return;
    if (observations.obstacles.some((o) => samePage(o.page_url, action.page_url))) return;
    const ref = `A${i + 1}`;
    const stepRefs = steps.filter((s) => s.agentAction?.ref === ref).map((s) => s.ref);
    const where = hostPath(action.page_url);
    findings.push({
      id: "",
      kind: "FUNCTIONAL_FAILURE",
      title: `Didn't work: ${truncate(action.description, 70)}`,
      whatHappened: `${action.description}${action.purpose ? ` (purpose: ${action.purpose})` : ""}. The agent reported this action as failed.`,
      stepRefs,
      pageUrl: action.page_url,
      designerAction: `Try this yourself on ${where}${stepsText(stepRefs)}. If it fails for a visitor too, fix the control; if it works, the agent's attempt may not match how people use it.`,
      evidenceRefs: [ref],
      affectsCriteria: [],
      origin: "RULES",
    });
  });

  // Unmet criteria that no obstacle explains.
  for (const c of checkpoints) {
    if (c.status !== "FAILED" || covered.has(c.id) || classifyTechnical(c.observation)) continue;
    findings.push({
      id: "",
      kind: "USABILITY_HYPOTHESIS",
      title: `Not met: ${truncate(c.description, 70)}`,
      whatHappened: c.observation ?? "The agent reported this criterion as not met.",
      stepRefs: [],
      pageUrl: c.pageUrl,
      designerAction: `Find out why ${c.id} failed: check ${hostPath(c.pageUrl)} for what the criterion needs, using the agent's note as a starting point.`,
      caveat: LOCATION_SENSITIVE.test(`${c.description} ${c.observation ?? ""}`) ? LOCATION_CAVEAT : undefined,
      evidenceRefs: [c.id],
      affectsCriteria: [c.id],
      origin: "RULES",
    });
  }

  return orderFindings(findings);
}

/** Functional failures first, then anything that cost a success criterion. */
export function orderFindings(findings: UXFinding[]): UXFinding[] {
  const rank = (f: UXFinding) => (f.kind === "FUNCTIONAL_FAILURE" ? 0 : 2) + (f.affectsCriteria.length ? 0 : 1);
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }, i) => ({ ...f, id: `F${i + 1}` }));
}

/* ------------------------------------------------------------------------ */
/* Summary and next action                                                   */
/* ------------------------------------------------------------------------ */

function lowerFirst(text: string): string {
  return text && !/^[A-Z]{2}/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

export function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return (match ? match[1] : text).trim();
}

function summarize(
  hasObservations: boolean,
  findings: UXFinding[],
  blockers: TechnicalBlocker[],
  patterns: JourneyPattern[],
): string {
  if (!hasObservations) {
    return "TinyFish didn't return a result FlowLens could check, so there are no findings. The journey timeline shows what was recorded.";
  }
  const sentences: string[] = [];
  const top = findings[0];
  if (top) {
    const more = findings.length - 1;
    sentences.push(
      `Main issue: ${lowerFirst(top.title)}${stepsText(top.stepRefs.slice(0, 3))}.${more > 0 ? ` ${more} more ${plural(more, "finding", "findings")} below.` : ""}`,
    );
  } else {
    sentences.push("The agent didn't report any usability obstacles on this journey.");
  }
  if (blockers.length > 0) {
    const names = blockers.map((b) => BLOCKER_PHRASE[b.kind]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    sentences.push(
      `${sentenceCase(list)} affected the test; ${plural(blockers.length, "it's", "they're")} listed under technical blockers, not treated as design issues.`,
    );
  }
  const notable = patterns.find((p) => ["REPEATED_ACTION", "BACKTRACKING", "ROUTE_CHANGE", "DEAD_END"].includes(p.kind));
  if (notable && sentences.length < 3) sentences.push(`The trace also shows: ${lowerFirst(notable.title)}.`);
  return sentences.slice(0, 3).join(" ");
}

const BLOCKER_PHRASE: Record<TechnicalBlocker["kind"], string> = {
  BOT_PROTECTION: "bot protection",
  PROXY_OR_NETWORK: "a proxy or network change",
  AGENT_ENVIRONMENT: "a run failure",
  SITE_UNREACHABLE: "an unreachable site",
  LOGIN_REQUIRED: "a sign-in requirement",
  REAL_WORLD_ACTION: "a real-transaction step",
};

function nextActionFor(
  session: TestSession,
  outcome: TaskOutcome,
  hasObservations: boolean,
  findings: UXFinding[],
  checkpoints: Checkpoint[],
  blockers: TechnicalBlocker[],
  steps: JourneyStep[],
): string {
  if (session.executionStatus === "FAILED") {
    return "Run the test again — this run ended with a technical error before the journey finished.";
  }
  if (session.executionStatus === "CANCELLED") {
    return "Run the test again and let it finish; this session was stopped before the agent was done.";
  }
  if (!hasObservations) return "Run the test again; TinyFish didn't return a result that could be checked.";

  const failure = findings.find((f) => f.kind === "FUNCTIONAL_FAILURE");
  if (failure) return firstSentence(failure.designerAction);
  const blocking = findings.find((f) => f.affectsCriteria.length > 0);
  if (blocking) return firstSentence(blocking.designerAction);
  const doubtful = checkpoints.find((c) => c.verification === "CONTRADICTED" || c.verification === "LIMITED");
  if (doubtful) {
    return `Check ${doubtful.id} yourself (“${truncate(doubtful.description, 70)}”): ${
      doubtful.verification === "LIMITED" ? "a technical blocker affected it" : "the evidence conflicts with the agent's claim"
    }, so the agent's result isn't confirmed.`;
  }
  if (findings[0]) return firstSentence(findings[0].designerAction);
  const stopper = blockers.find((b) => b.stoppedRun);
  if (stopper) {
    return `${stopper.title.replace(/ \(test boundary\)$/, "")} stopped the agent, so test this journey with a person instead.`;
  }
  if (outcome === "REPORTED_COMPLETE") {
    const shots = steps.filter((s) => s.hasScreenshot && !s.terminal).slice(-2).map((s) => s.ref);
    return `Look at the final screenshots${shots.length ? ` (${shots.join(", ")})` : ""} to confirm the agent's result, then test the journey with participants.`;
  }
  if (outcome === "VERIFIED_COMPLETE") {
    return "No usability issues were observed. Test the journey with participants before treating it as validated.";
  }
  return "Review the journey timeline to see where the agent stopped.";
}

/* ------------------------------------------------------------------------ */
/* Limitations and report assembly                                           */
/* ------------------------------------------------------------------------ */

function buildLimitations(session: TestSession, extra: string[]): string[] {
  const limitations = [LIMITATION_AGENT];
  limitations.push(
    "The agent ran in a desktop cloud browser. Device, assistive-technology or accessibility needs described in the persona were not emulated.",
  );
  limitations.push(
    "The cloud browser runs from TinyFish's infrastructure, which may be in a different country from the persona. Location-dependent content (currency, prices, availability) can differ from what the persona would see.",
  );
  limitations.push(
    "TinyFish records each step's stated purpose, time and screenshot, but not the page URL or outcome of each step. Those details come from the agent's end-of-run report where they could be matched.",
  );
  if (!session.steps.some((s) => s.hasScreenshot)) {
    limitations.push("No screenshots were captured for this run. Evidence is limited to the timeline and the agent's reports.");
  }
  limitations.push("The live browser stream is not recorded by FlowLens and expires after the run.");
  return [...limitations, ...extra];
}

/** The evidence-only report for a completed run. */
export function buildEvidenceSummaryReport(session: TestSession, methodNote?: string): UsabilityReport {
  const { data: observations, reason } = getObservations(session);
  const trace = buildJourneyTrace(session, observations);
  const checkpoints = buildCheckpoints(session.definition.successCriteria, observations);
  const technicalBlockers = buildTechnicalBlockers(session, observations, trace.steps, checkpoints);
  const patterns = detectPatterns(trace, observations, checkpoints, {
    goal: session.definition.goal,
    websiteUrl: session.definition.websiteUrl,
  });
  const { outcome, rationale } = deriveTaskOutcome({
    executionStatus: session.executionStatus === "ANALYSING" ? "COMPLETED" : session.executionStatus,
    observations,
    checkpoints,
    blockers: technicalBlockers,
  });
  const findings = buildRuleBasedFindings(session, observations, checkpoints, trace.steps);
  const extra: string[] = [];
  if (!observations && reason) extra.push(reason);

  return {
    version: REPORT_VERSION,
    sessionId: session.id,
    generatedAt: new Date().toISOString(),
    method: "EVIDENCE_SUMMARY",
    methodNote:
      methodNote ??
      "Evidence summary: the timeline, patterns and findings are derived by fixed rules from what TinyFish recorded and what the agent reported. No AI interpretation was applied.",
    taskOutcome: outcome,
    outcomeRationale: rationale,
    summary: summarize(Boolean(observations), findings, technicalBlockers, patterns),
    nextAction: nextActionFor(session, outcome, Boolean(observations), findings, checkpoints, technicalBlockers, trace.steps),
    agentSummary: observations?.outcome_summary || undefined,
    finalAnswer: observations?.final_answer,
    checkpoints,
    journey: { ...trace, patterns },
    findings,
    technicalBlockers,
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
  if (!stopped) return { ...report, limitations: [...report.limitations, note] };
  return {
    ...report,
    // A stopped or failed run never yields findings or a task verdict.
    taskOutcome: "NOT_VERIFIED",
    outcomeRationale: note,
    findings: [],
    summary:
      "This session didn't finish, so no usability findings were produced. The journey timeline shows what the agent did before it stopped.",
    methodNote: "Partial evidence only. The session did not finish, so no analysis was performed.",
  };
}
