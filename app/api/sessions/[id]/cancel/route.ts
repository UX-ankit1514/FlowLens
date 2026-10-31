import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginOrNonBrowser, keysFromRequest } from "@/lib/keys";
import { loadSession } from "@/lib/sessions/service";
import { requestCancel } from "@/lib/tinyfish/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/sessions/:id/cancel — cancels the underlying TinyFish run. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/cancel">) {
  const { id } = await ctx.params;
  if (!isSameOriginOrNonBrowser(request)) {
    return NextResponse.json({ error: "Requests from other websites aren't allowed." }, { status: 403 });
  }
  if (!(await loadSession(id, keysFromRequest(request)))) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const outcome = await requestCancel(id);
  return NextResponse.json(outcome, { status: outcome.accepted ? 202 : 409 });
}
