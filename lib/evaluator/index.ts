import "server-only";
import type { TestSession, UsabilityReport } from "@/types";
import { describeAiError, interpretWithAi, isAiConfigured } from "./ai-evaluator";
import { buildEvidenceSummaryReport, buildFallbackReport } from "./evidence-summary";

export { buildFallbackReport };

/**
 * Report evaluator. Always builds the evidence summary from observed data;
 * adds AI interpretation when a reasoning-model key is configured. If AI
 * interpretation fails, the evidence summary is returned with an explicit note
 * — it never pretends an AI analysis happened.
 */
export async function evaluateSession(session: TestSession): Promise<UsabilityReport> {
  const base = buildEvidenceSummaryReport(session);
  if (!isAiConfigured() || !base.structuredResultValid) {
    return base;
  }
  try {
    return await interpretWithAi(session, base);
  } catch (error) {
    const reason = describeAiError(error);
    console.warn(`[flowlens] AI interpretation unavailable: ${reason}`);
    return {
      ...base,
      aiUnavailableReason: reason,
      methodNote: `Evidence summary only — AI interpretation was attempted but ${reason}. Findings are assembled by fixed rules from what the browser agent reported.`,
    };
  }
}
