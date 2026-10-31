import type { NextRequest } from "next/server";
import { keysFromRequest } from "@/lib/keys";
import { loadSession } from "@/lib/sessions/service";
import { fetchStepScreenshot } from "@/lib/tinyfish/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/:id/evidence/:stepId — the screenshot TinyFish captured
 * for a step of this session's run. Proxied so the API key stays server-side.
 * Only steps that belong to this session's run can be requested.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/evidence/[stepId]">) {
  const { id, stepId } = await ctx.params;
  const keys = keysFromRequest(request);
  const session = await loadSession(id, keys);
  const step = session?.steps.find((s) => s.stepId === stepId);
  if (!session?.providerRunId || !step?.hasScreenshot) {
    return new Response("Screenshot not available", { status: 404 });
  }

  const upstream = await fetchStepScreenshot(session.providerRunId, stepId, keys.tinyfish).catch(() => null);
  if (upstream?.status === 404) {
    return new Response("TinyFish has no stored screenshot for this step", { status: 404 });
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("Screenshot could not be retrieved from TinyFish", { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "image/jpeg";
  if (!type.startsWith("image/")) {
    return new Response("Unexpected response from TinyFish", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
