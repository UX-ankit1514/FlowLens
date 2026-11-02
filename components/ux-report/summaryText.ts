import { CHECKPOINT_VIEW, FINDING_KIND_VIEW, TASK_OUTCOME_VIEW, VERIFICATION_VIEW, formatDateTime } from "@/lib/presentation/labels";
import { SEVERITY_VIEW, bySeverity, humanizeRefs, readableDuration } from "@/lib/presentation/report-view";
import type { TestSession, UsabilityReport } from "@/types";

/**
 * Plain-text summary for "Copy summary". Same order as the report, so it
 * pastes cleanly into a doc, Slack thread or ticket: result, top issues
 * with what to do, what worked, criteria, then the caveat.
 */
export function buildSummaryText(session: TestSession, report: UsabilityReport): string {
  const d = session.definition;
  const known = new Set<string>([
    ...report.evidence.map((e) => e.ref),
    ...report.journey.steps.map((s) => s.ref),
    ...report.checkpoints.map((c) => c.id),
    ...report.findings.map((f) => f.id),
    ...report.technicalBlockers.map((b) => b.id),
  ]);
  const plain = (text: string) => humanizeRefs(text, (ref) => known.has(ref));
  const stopped = session.executionStatus !== "COMPLETED";
  const met = report.checkpoints.filter((c) => c.status === "PASSED");
  const steps = report.journey.steps.filter((s) => !s.terminal).length;

  const lines: string[] = [];
  lines.push(`Usability test: ${d.sessionName || d.goal}`);
  lines.push(
    [
      d.websiteUrl,
      formatDateTime(session.startedAt ?? session.createdAt),
      report.journey.durationMs !== undefined ? `${steps} steps in ${readableDuration(report.journey.durationMs)}` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  lines.push("");
  lines.push(
    `Result: ${TASK_OUTCOME_VIEW[report.taskOutcome].label}${
      report.checkpoints.length ? ` (${met.length} of ${report.checkpoints.length} success criteria met)` : ""
    }`,
  );
  lines.push(plain(report.outcomeRationale));
  lines.push(plain(report.summary));

  if (!stopped && report.findings.length) {
    lines.push("");
    lines.push("Issues to fix (most severe first):");
    bySeverity(report.findings, report.checkpoints).forEach(({ finding, severity }, i) => {
      lines.push(`${i + 1}. [${SEVERITY_VIEW[severity].short}] ${finding.title} (${FINDING_KIND_VIEW[finding.kind].label.toLowerCase()})`);
      lines.push(`   What happened: ${plain(finding.whatHappened)}`);
      lines.push(`   What to do: ${plain(finding.designerAction)}`);
    });
  }

  if (met.length) {
    lines.push("");
    lines.push("What worked:");
    for (const c of met) {
      const how = VERIFICATION_VIEW[c.verification].label;
      lines.push(`- ${c.description}${how ? ` (${how.toLowerCase()})` : ""}`);
    }
  }

  const unmet = report.checkpoints.filter((c) => c.status !== "PASSED");
  if (unmet.length) {
    lines.push("");
    lines.push("Success criteria not met:");
    for (const c of unmet) lines.push(`- ${CHECKPOINT_VIEW[c.status].label}: ${c.description}`);
  }

  if (report.technicalBlockers.length) {
    lines.push("");
    lines.push("Test-setup issues (not design issues):");
    for (const b of report.technicalBlockers) lines.push(`- ${b.title}`);
  }

  lines.push("");
  lines.push(`Recommended next step: ${plain(report.nextAction)}`);
  lines.push("");
  lines.push("Tested by an AI agent using the persona, not by real people. Treat issues as leads to confirm with participants.");
  return lines.join("\n");
}
