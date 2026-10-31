import { FINDING_KIND_VIEW, TASK_OUTCOME_VIEW, VERIFICATION_VIEW, CHECKPOINT_VIEW, formatDateTime } from "@/lib/presentation/labels";
import type { TestSession, UsabilityReport } from "@/types";

/** Plain-text summary for "Copy summary" (pastes cleanly into docs, Slack or tickets). */
export function buildSummaryText(session: TestSession, report: UsabilityReport): string {
  const d = session.definition;
  const lines: string[] = [];
  lines.push(`FlowLens usability session — ${d.sessionName || d.goal}`);
  lines.push(`Website: ${d.websiteUrl} · ${formatDateTime(session.startedAt ?? session.createdAt)}`);
  lines.push(`Outcome: ${TASK_OUTCOME_VIEW[report.taskOutcome].label} — ${report.outcomeRationale}`);
  lines.push("");
  lines.push(report.summary);
  lines.push(`Next action: ${report.nextAction}`);
  lines.push("");
  lines.push("Success criteria:");
  for (const c of report.checkpoints) {
    const v = VERIFICATION_VIEW[c.verification].label;
    lines.push(`- ${c.id} [${CHECKPOINT_VIEW[c.status].label}${v ? `, ${v.toLowerCase()}` : ""}] ${c.description}`);
  }
  if (report.findings.length) {
    lines.push("");
    lines.push("UX findings (human validation: not tested unless noted in FlowLens):");
    for (const f of report.findings) {
      lines.push(`- ${f.id} ${f.title} (${FINDING_KIND_VIEW[f.kind].label}${f.stepRefs.length ? `, ${f.stepRefs.slice(0, 4).join(", ")}` : ""})`);
      lines.push(`  What happened: ${f.whatHappened}`);
      lines.push(`  Investigate: ${f.designerAction}`);
    }
  }
  if (report.technicalBlockers.length) {
    lines.push("");
    lines.push("Technical blockers (test environment, not usability findings):");
    for (const b of report.technicalBlockers) lines.push(`- ${b.title}: ${b.description}`);
  }
  lines.push("");
  lines.push(report.methodNote);
  lines.push(report.limitations[0]);
  return lines.join("\n");
}
