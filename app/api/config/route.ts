import { NextResponse, type NextRequest } from "next/server";
import { connectionView } from "@/lib/connections";
import { keysFromRequest } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config — which integrations this requester has connected (never the keys). */
export async function GET(request: NextRequest) {
  return NextResponse.json(connectionView(keysFromRequest(request)), {
    headers: { "Cache-Control": "no-store" },
  });
}
