import { after, NextResponse, type NextRequest } from "next/server";
import { isSameOriginOrNonBrowser, keysFromRequest } from "@/lib/keys";
import { handleMcpMessage } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256_000;

/**
 * POST /api/mcp — FlowLens as an MCP server (Streamable HTTP, stateless, JSON
 * responses) for Claude Code, Codex and other MCP clients.
 *
 * Authentication: the caller's own TinyFish key, sent as
 * `X-TinyFish-Api-Key: <key>` or `Authorization: Bearer <key>`. An optional
 * `X-Anthropic-Api-Key` enables the reasoning-model analysis in reports.
 */
export async function POST(request: NextRequest) {
  // Browsers on other sites must not drive this endpoint; MCP clients send no Origin.
  if (!isSameOriginOrNonBrowser(request)) {
    return NextResponse.json({ error: "Requests from other websites aren't allowed." }, { status: 403 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } },
      { status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const deferred: Promise<unknown>[] = [];
  const ctx = {
    keys: keysFromRequest(request),
    baseUrl: request.nextUrl.origin,
    defer: (work: Promise<unknown>) => void deferred.push(work),
  };

  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map((m) => handleMcpMessage(m ?? {}, ctx)))).filter(Boolean);
  // Reports that are still being written keep going after the response.
  if (deferred.length) after(() => Promise.allSettled(deferred));

  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], {
    headers: { "Cache-Control": "no-store" },
  });
}

/** The server doesn't open a separate event stream; clients use POST only. */
export async function GET() {
  return new Response("FlowLens MCP endpoint. Connect with an MCP client using POST (Streamable HTTP).", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
