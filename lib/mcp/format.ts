import {
  CHECKPOINT_VIEW,
  FINDING_KIND_VIEW,
  TASK_OUTCOME_VIEW,
  VERIFICATION_VIEW,
  sessionStatusView,
} from "@/lib/presentation/labels";
import { TECHNICAL_KIND_LABEL } from "@/lib/journey/classify";
import type { RecentSessionSummary, TestSession, UsabilityReport } from "@/types";

/** Plain-text views of FlowLens sessions for MCP clients (Claude Code, Codex). */

const STATUS_WORD: Record<TestSession["executionStatus"], string> = {
  CREATED: "starting",
  STARTING: "starting",
  RUNNING: "running",
  ANALYSING: "analysing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "stopped",
};

export function links(baseUrl: string, id: string) {
  return { live: `${baseUrl}/sessions/${id}`, report: `${baseUrl}/sessions/${id}/report` };
}

function seconds(from?: string, to?: string): string | undefined {
  if (!from) return undefined;
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function statusText(session: TestSession, baseUrl: string): string {
  const url = links(baseUrl, session.id);
  const status = sessionStatusView(session);
  const progress = session.events.filter((e) => e.type === "AGENT_PROGRESS");
  const lines = [
    `Test ${session.id}: ${STATUS_WORD[session.executionStatus]} (${status.label})`,
    `Website: ${session.definition.websiteUrl}`,
    `Goal: ${session.definition.goal}`,
  ];
  const elapsed = seconds(session.startedAt ?? session.createdAt, session.finishedAt);
  if (elapsed) lines.push(`Elapsed: ${elapsed}`);
  if (progress.length > 0) {
    lines.push(`Agent steps so far: ${progress.length}`);
    lines.push("Latest steps:");
    for (const event of progress.slice(-5)) lines.push(`  - ${event.description}`);
  }
  if (session.streamingUrl && session.liveViewStatus === "AVAILABLE") lines.push(`Live browser view: ${session.streamingUrl}`);
  lines.push(`Watch in FlowLens: ${url.live}`);

  if (session.error) lines.push("", `Run problem: ${session.error.message}`);

  if (session.report) {
    lines.push("", reportSummary(session.report), "", `Full report in FlowLens: ${url.report}`);
    lines.push("Call get_test_report for the step-by-step journey, findings and evidence.");
  } else if (session.executionStatus === "ANALYSING") {
    lines.push("", "The run has finished and the report is being written. Call get_test_status again shortly.");
  } else if (session.executionStatus === "STARTING" || session.executionStatus === "RUNNING" || session.executionStatus === "CREATED") {
    lines.push("", "Still running. Call get_test_status again to keep following it (tests usually take 1–8 minutes).");
  }
  return lines.join("\n");
}

export function reportSummary(report: UsabilityReport): string {
  const outcome = TASK_OUTCOME_VIEW[report.taskOutcome];
  const functional = report.findings.filter((f) => f.kind === "FUNCTIONAL_FAILURE").length;
  return [
    `Outcome: ${outcome?.label ?? report.taskOutcome} — ${report.outcomeRationale}`,
    `Summary: ${report.summary}`,
    `Most important next action: ${report.nextAction}`,
    `UX findings: ${report.findings.length} (${functional} functional ${functional === 1 ? "failure" : "failures"}, ${report.findings.length - functional} to validate)`,
    `Technical testing blockers: ${report.technicalBlockers.length} (not usability issues)`,
    "Human validation: not tested unless recorded in FlowLens",
    `Analysis: ${report.aiModel ? `reasoning model (${report.aiModel}) with evidence checks` : "rule-based evidence summary"}`,
  ].join("\n");
}

export function reportText(session: TestSession, baseUrl: string): string {
  const report = session.report;
  if (!report) return statusText(session, baseUrl);
  const def = session.definition;
  const out: string[] = [];
  out.push(`# FlowLens report: ${def.sessionName || def.goal}`);
  out.push("", `Website: ${def.websiteUrl}`, `Persona: ${def.persona.description}`, `Goal: ${def.goal}`);
  out.push("", "## Verdict", reportSummary(report));

  out.push("", "## Success criteria");
  for (const c of report.checkpoints) {
    out.push(
      `- ${c.id} ${c.description} — ${CHECKPOINT_VIEW[c.status]?.label ?? c.status}; ${VERIFICATION_VIEW[c.verification]?.label ?? c.verification}` +
        (c.verificationNote ? ` (${c.verificationNote})` : ""),
    );
  }

  out.push("", "## Journey timeline");
  out.push(report.journey.completenessNote);
  for (const step of report.journey.steps) {
    const at = step.elapsedMs !== undefined ? ` [${Math.round(step.elapsedMs / 1000)}s]` : "";
    const flags = step.flags.length ? ` {${step.flags.map((f) => f.kind.toLowerCase()).join(", ")}}` : "";
    const purpose = step.statedPurpose || (step.inferredPurpose ? `(inferred) ${step.inferredPurpose}` : "");
    const page = step.agentAction?.pageUrl ? ` — page: ${step.agentAction.pageUrl}` : "";
    const result = step.result ? ` — result: ${step.result.text}` : "";
    out.push(`- ${step.ref}${at}${flags} ${purpose}${page}${result}`);
  }
  if (report.journey.patterns.length) {
    out.push("", "## Journey patterns");
    for (const p of report.journey.patterns) out.push(`- ${p.title} (${p.stepRefs.join(", ")}): ${p.description}`);
  }

  out.push("", "## UX findings");
  if (report.findings.length === 0) out.push("None supported by the evidence.");
  for (const f of report.findings) {
    out.push(`### ${f.id} ${f.title} — ${FINDING_KIND_VIEW[f.kind]?.label ?? f.kind}`);
    out.push(`What happened: ${f.whatHappened}`);
    if (f.stepRefs.length) out.push(`Steps: ${f.stepRefs.join(", ")}${f.pageUrl ? ` on ${f.pageUrl}` : ""}`);
    if (f.personaImpact) out.push(`Why it matters: ${f.personaImpact}`);
    out.push(`Designer action: ${f.designerAction}`);
    if (f.caveat) out.push(`Caveat: ${f.caveat}`);
  }

  out.push("", "## Technical testing blockers (not usability issues)");
  if (report.technicalBlockers.length === 0) out.push("None.");
  for (const b of report.technicalBlockers) {
    out.push(`- ${b.id} ${TECHNICAL_KIND_LABEL[b.kind] ?? b.kind}: ${b.title}. ${b.effect}`);
  }

  const validations = session.validations ?? [];
  out.push("", "## Human validation");
  out.push(
    validations.length
      ? validations.map((v) => `- ${v.findingId}: ${v.status.toLowerCase().replace("_", " ")}${v.note ? ` — ${v.note}` : ""}`).join("\n")
      : "Not tested with real participants.",
  );

  if (report.limitations.length) {
    out.push("", "## Limitations");
    for (const l of report.limitations) out.push(`- ${l}`);
  }
  out.push("", `Open in FlowLens: ${links(baseUrl, session.id).report}`);
  return out.join("\n");
}

export function recentText(items: RecentSessionSummary[], baseUrl: string): string {
  if (items.length === 0) return "No FlowLens tests yet for this TinyFish key.";
  return items
    .map((s) => {
      const outcome = s.taskOutcome ? ` · ${TASK_OUTCOME_VIEW[s.taskOutcome]?.label ?? s.taskOutcome}` : "";
      return `- ${s.id} · ${STATUS_WORD[s.executionStatus]}${outcome} · ${s.createdAt.slice(0, 16).replace("T", " ")} · ${s.websiteUrl}\n  ${s.goal}\n  ${links(baseUrl, s.id).live}`;
    })
    .join("\n");
}
