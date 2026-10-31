import { NextResponse, type NextRequest } from "next/server";
import { sessionStore } from "@/lib/session-store/store";
import { requestCancel } from "@/lib/tinyfish/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/sessions/:id/cancel — cancels the underlying TinyFish run. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/cancel">) {
  const { id } = await ctx.params;
  if (!sessionStore.get(id)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const outcome = await requestCancel(id);
  return NextResponse.json(outcome, { status: outcome.accepted ? 202 : 409 });
}
