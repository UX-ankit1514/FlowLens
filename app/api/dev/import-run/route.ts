import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { evaluateSession } from "@/lib/evaluator";
import { sessionStore } from "@/lib/session-store/store";
import { getRunDetails } from "@/lib/tinyfish/client";
import { sessionFromRunRecord } from "@/lib/tinyfish/import-run";
import { buildFallbackReport } from "@/lib/evaluator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ runId: z.string().regex(/^[0-9a-f-]{36}$/i, "Use a TinyFish run id.") });

/**
 * POST /api/dev/import-run — development only. Reopens an earlier
 * FlowLens-started TinyFish run (from TinyFish's run record) as a session, so
 * its report can be viewed in the current format without a new run.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 422 });
  }
  let imported;
  try {
    imported = sessionFromRunRecord(await getRunDetails(parsed.data.runId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't load the run." }, { status: 422 });
  }
  const created = sessionStore.create(imported.definition);
  sessionStore.update(created.id, (s) => {
    Object.assign(s, { ...imported, id: created.id, definition: { ...imported.definition, id: created.id } });
  });
  const session = sessionStore.get(created.id)!;
  const report =
    session.executionStatus === "COMPLETED"
      ? await evaluateSession(session)
      : buildFallbackReport(session, session.error?.message ?? "The designer stopped this session before the agent finished.");
  sessionStore.update(created.id, (s) => {
    s.report = report;
    s.taskOutcome = report.taskOutcome;
  });
  return NextResponse.json({ id: created.id, reportUrl: `/sessions/${created.id}/report` }, { status: 201 });
}
