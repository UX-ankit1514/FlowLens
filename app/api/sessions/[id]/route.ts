import { after, NextResponse, type NextRequest } from "next/server";
import { keysFromRequest } from "@/lib/keys";
import { isTerminal } from "@/lib/session-store/transitions";
import { loadSession } from "@/lib/sessions/service";
import { sessionWork } from "@/lib/tinyfish/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions/:id — full session state, events and report (if ready). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  // Older saved reports are rebuilt in the current format; sessions this server
  // doesn't hold are rebuilt from TinyFish's run record with the caller's key.
  const session = await loadSession(id, keysFromRequest(request), { waitMs: 8_000 });
  if (!session) {
    return NextResponse.json(
      { error: "Test not found. It may have been run with a different TinyFish key." },
      { status: 404 },
    );
  }
  // Let a report that's still being written finish after this response.
  if (!isTerminal(session.executionStatus)) after(() => sessionWork(id));
  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
