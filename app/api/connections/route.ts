import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { connectionView, verifyClaudeKey } from "@/lib/connections";
import {
  ANTHROPIC_COOKIE,
  TINYFISH_COOKIE,
  cleanKey,
  isSameOriginOrNonBrowser,
  keysFromRequest,
  type ApiKeys,
} from "@/lib/keys";
import { verifyTinyFishKey } from "@/lib/tinyfish/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const bodySchema = z.object({
  provider: z.enum(["tinyfish", "claude"]),
  apiKey: z.string().max(400),
});

function cookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:" || Boolean(process.env.VERCEL),
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

function forbidden() {
  return NextResponse.json({ error: "Requests from other websites aren't allowed." }, { status: 403 });
}

/** GET /api/connections — connection status for this browser (never the keys). */
export async function GET(request: NextRequest) {
  return NextResponse.json(connectionView(keysFromRequest(request)), { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/connections — checks a key with its provider, then stores it in a
 * secure, HttpOnly cookie for this browser. The key is never sent back.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginOrNonBrowser(request)) return forbidden();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste an API key first." }, { status: 422 });

  const key = cleanKey(parsed.data.apiKey);
  if (!key) {
    return NextResponse.json(
      { error: "That doesn't look like an API key. Copy the whole key, without spaces." },
      { status: 422 },
    );
  }

  const check = parsed.data.provider === "tinyfish" ? await verifyTinyFishKey(key) : await verifyClaudeKey(key);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 422 });

  const current = keysFromRequest(request);
  const next: ApiKeys =
    parsed.data.provider === "tinyfish"
      ? { ...current, tinyfish: key, tinyfishSource: "browser" }
      : { ...current, anthropic: key, anthropicSource: "browser" };
  const response = NextResponse.json(connectionView(next), { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(parsed.data.provider === "tinyfish" ? TINYFISH_COOKIE : ANTHROPIC_COOKIE, key, cookieOptions(request));
  return response;
}

/** DELETE /api/connections?provider=tinyfish|claude — forgets a key saved in this browser. */
export async function DELETE(request: NextRequest) {
  if (!isSameOriginOrNonBrowser(request)) return forbidden();
  const provider = request.nextUrl.searchParams.get("provider");
  if (provider !== "tinyfish" && provider !== "claude") {
    return NextResponse.json({ error: "Unknown connection." }, { status: 422 });
  }
  const name = provider === "tinyfish" ? TINYFISH_COOKIE : ANTHROPIC_COOKIE;
  // Recompute without the browser key (a server key, if any, still applies).
  const remaining = keysFromRequest(request);
  if (provider === "tinyfish" && remaining.tinyfishSource === "browser") {
    delete remaining.tinyfish;
    delete remaining.tinyfishSource;
    const server = cleanKey(process.env.TINYFISH_API_KEY);
    if (server) Object.assign(remaining, { tinyfish: server, tinyfishSource: "server" });
  }
  if (provider === "claude" && remaining.anthropicSource === "browser") {
    delete remaining.anthropic;
    delete remaining.anthropicSource;
    const server = cleanKey(process.env.ANTHROPIC_API_KEY);
    if (server) Object.assign(remaining, { anthropic: server, anthropicSource: "server" });
  }
  const response = NextResponse.json(connectionView(remaining), { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(name, "", { ...cookieOptions(request), maxAge: 0 });
  return response;
}
