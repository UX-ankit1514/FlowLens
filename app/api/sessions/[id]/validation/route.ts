import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSameOriginOrNonBrowser, keysFromRequest } from "@/lib/keys";
import { sessionStore } from "@/lib/session-store/store";
import { loadSession } from "@/lib/sessions/service";
import type { HumanValidation } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validationSchema = z.object({
  findingId: z.string().regex(/^F\d+$/, "Unknown finding."),
  status: z.enum(["NOT_TESTED", "OBSERVED", "NOT_OBSERVED"]),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

/**
 * POST /api/sessions/:id/validation — the designer records whether a finding
 * was observed with real research participants. FlowLens never sets this
 * itself; without a record, every finding is "Not tested".
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/validation">) {
  const { id } = await ctx.params;
  const session = isSameOriginOrNonBrowser(request) ? await loadSession(id, keysFromRequest(request)) : undefined;
  if (!session?.report) {
    return NextResponse.json({ error: "Session or report not found." }, { status: 404 });
  }
  const parsed = validationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 422 });
  }
  const { findingId, status, note } = parsed.data;
  if (!session.report.findings.some((f) => f.id === findingId)) {
    return NextResponse.json({ error: "That finding isn't in this report." }, { status: 404 });
  }
  const record: HumanValidation = { findingId, status, note: note || undefined, updatedAt: new Date().toISOString() };
  sessionStore.update(id, (s) => {
    s.validations = [...(s.validations ?? []).filter((v) => v.findingId !== findingId), record];
  });
  return NextResponse.json(record);
}
