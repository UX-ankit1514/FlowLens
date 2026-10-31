import { NextResponse } from "next/server";
import { AI_MODEL, isAiConfigured } from "@/lib/evaluator/ai-evaluator";
import { isTinyFishConfigured } from "@/lib/tinyfish/client";
import type { AppConfigView } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config — which server-side integrations are configured (never the keys). */
export async function GET() {
  const ai = isAiConfigured();
  const body: AppConfigView = {
    tinyfishConfigured: isTinyFishConfigured(),
    aiInterpretationEnabled: ai,
    aiModel: ai ? AI_MODEL : undefined,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
