import { NextResponse, type NextRequest } from "next/server";
import { sessionStore } from "@/lib/session-store/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions/:id — full session state, events and report (if ready). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  const session = sessionStore.get(id);
  if (!session) {
    return NextResponse.json(
      { error: "Session not found. Sessions are kept in memory and are cleared when FlowLens restarts." },
      { status: 404 },
    );
  }
  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
