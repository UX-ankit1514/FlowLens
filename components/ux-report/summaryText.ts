import { CATEGORY_VIEW, CHECKPOINT_VIEW, SEVERITY_VIEW, TASK_OUTCOME_VIEW, formatDateTime } from "@/lib/presentation/labels";
import type { TestSession, UsabilityReport } from "@/types";

/** Plain-text summary for "Copy summary" (pastes cleanly into docs, Slack or tickets). */
export function buildSummaryText(session: TestSession, report: UsabilityReport): string {
  const d = session.definition;
  const lines: string[] = [];
  lines.push(`FlowLens usability session — ${d.sessionName || d.goal}`);
  lines.push(`Website: ${d.websiteUrl}`);
  lines.push(`Date: ${formatDateTime(session.startedAt ?? session.createdAt)}`);
  lines.push(`Task outcome: ${TASK_OUTCOME_VIEW[report.taskOutcome].label} — ${report.outcomeRationale}`);
  lines.push("");
  lines.push(`Goal: ${d.goal}`);
  lines.push("");
  lines.push("Checkpoints:");
  for (const c of report.checkpoints) lines.push(`- [${CHECKPOINT_VIEW[c.status].label}] ${c.description}`);
  lines.push("");
  lines.push(`Summary: ${report.summary}`);
  if (report.findings.length) {
    lines.push("");
    lines.push("Findings:");
    for (const f of report.findings) {
      lines.push(`- ${f.title} (${CATEGORY_VIEW[f.category].label}, ${SEVERITY_VIEW[f.severity].label})`);
      lines.push(`  Observed: ${f.observation}`);
      lines.push(`  Next step: ${f.recommendation}`);
    }
  }
  if (report.blockers.length) {
    lines.push("");
    lines.push("Test blockers (not usability findings):");
    for (const b of report.blockers) lines.push(`- ${b.kind}: ${b.description}`);
  }
  lines.push("");
  lines.push(report.methodNote);
  lines.push(report.limitations[0]);
  return lines.join("\n");
}
