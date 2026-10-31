import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginOrNonBrowser, keysFromRequest } from "@/lib/keys";
import { listRecentSessions, startTest, StartTestError } from "@/lib/sessions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions — newest-first history for this requester's key. */
export async function GET(request: NextRequest) {
  return NextResponse.json(await listRecentSessions(keysFromRequest(request)), {
    headers: { "Cache-Control": "no-store" },
  });
}

/** POST /api/sessions — validate a test definition and start a real TinyFish run. */
export async function POST(request: NextRequest) {
  if (!isSameOriginOrNonBrowser(request)) {
    return NextResponse.json({ error: "Requests from other websites aren't allowed." }, { status: 403 });
  }
  const keys = keysFromRequest(request);
  if (!keys.tinyfish) {
    return NextResponse.json(
      { error: "Connect your TinyFish API key first: open Connections at the top of the page." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const session = await startTest(body, keys);
    return NextResponse.json({ id: session.id }, { status: 201 });
  } catch (error) {
    if (error instanceof StartTestError) {
      return NextResponse.json(
        { error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) },
        { status: error.status },
      );
    }
    throw error;
  }
}
