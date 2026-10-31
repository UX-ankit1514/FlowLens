import "server-only";
import { sessionStore } from "@/lib/session-store/store";
import { isTerminal } from "@/lib/session-store/transitions";
import type { TestSession } from "@/types";
import { REPORT_VERSION, buildEvidenceSummaryReport, buildFallbackReport } from "./evidence-summary";

/**
 * Saved sessions can hold a report written by an older FlowLens. When one is
 * opened, the report is rebuilt in the current format from the session's own
 * recorded evidence (step record, agent result, events). The rebuild is
 * rule-based; it doesn't call TinyFish or an AI model, and it says so.
 */
export function ensureCurrentReport(id: string): TestSession | undefined {
  const session = sessionStore.get(id);
  if (!session?.report || session.report.version === REPORT_VERSION || !isTerminal(session.executionStatus)) {
    return session;
  }
  try {
    const report =
      session.executionStatus === "COMPLETED"
        ? {
            ...buildEvidenceSummaryReport(session),
            methodNote:
              "Rebuilt in the current report format from this session's recorded evidence. Rule-based: no AI interpretation was applied to this version.",
          }
        : buildFallbackReport(
            session,
            session.executionStatus === "CANCELLED"
              ? "The designer stopped this session before the agent finished."
              : (session.error?.message ?? "The run ended with a technical failure."),
          );
    return sessionStore.update(id, (s) => {
      s.report = report;
      s.taskOutcome = report.taskOutcome;
    });
  } catch (error) {
    console.warn(`[flowlens] could not rebuild the report for ${id}`, error);
    return session;
  }
}
