import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * API keys for a request.
 *
 * FlowLens runs on the designer's own TinyFish account (and, optionally, their
 * own Claude key). Keys come from, in order:
 *   1. request headers — used by Claude Code, Codex and other MCP clients;
 *   2. secure, HttpOnly cookies — set from the Connections panel in the app;
 *   3. server environment variables — a local install or a shared deployment.
 *
 * Keys are never written to session records, logs or responses. Sessions only
 * keep a one-way fingerprint of the TinyFish key so each designer sees their
 * own tests on a shared deployment.
 */

export const TINYFISH_COOKIE = "flowlens_tinyfish_key";
export const ANTHROPIC_COOKIE = "flowlens_anthropic_key";
export const TINYFISH_HEADER = "x-tinyfish-api-key";
export const ANTHROPIC_HEADER = "x-anthropic-api-key";

export type KeySource = "header" | "browser" | "server";

export type ApiKeys = {
  tinyfish?: string;
  tinyfishSource?: KeySource;
  anthropic?: string;
  anthropicSource?: KeySource;
};

export type KeyProvider = "tinyfish" | "anthropic";

/** True on a hosted deployment, where several people can share one FlowLens. */
export function isHosted(): boolean {
  return Boolean(process.env.VERCEL) || process.env.FLOWLENS_MULTI_USER === "1";
}

export function serverKey(provider: KeyProvider): string | undefined {
  const value = provider === "tinyfish" ? process.env.TINYFISH_API_KEY : process.env.ANTHROPIC_API_KEY;
  return cleanKey(value);
}

/** Basic shape check: keys are single tokens of printable characters. */
export function cleanKey(value: string | null | undefined): string | undefined {
  const key = value?.trim();
  if (!key || key.length < 12 || key.length > 300 || !/^[\x21-\x7e]+$/.test(key)) return undefined;
  return key;
}

function bearer(value: string | null): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? "");
  return cleanKey(match?.[1]);
}

type CookieReader = { get(name: string): { value: string } | undefined };

/** Resolves keys from headers/cookies of a route-handler request. */
export function keysFromRequest(request: NextRequest): ApiKeys {
  return resolveKeys(request.headers, request.cookies);
}

/** Resolves keys from a header bag and a cookie store (also used by server components). */
export function resolveKeys(headers: Headers | { get(name: string): string | null }, cookies?: CookieReader): ApiKeys {
  const keys: ApiKeys = {};

  const headerTinyfish = cleanKey(headers.get(TINYFISH_HEADER)) ?? bearer(headers.get("authorization"));
  const cookieTinyfish = cleanKey(cookies?.get(TINYFISH_COOKIE)?.value);
  const envTinyfish = serverKey("tinyfish");
  if (headerTinyfish) Object.assign(keys, { tinyfish: headerTinyfish, tinyfishSource: "header" });
  else if (cookieTinyfish) Object.assign(keys, { tinyfish: cookieTinyfish, tinyfishSource: "browser" });
  else if (envTinyfish) Object.assign(keys, { tinyfish: envTinyfish, tinyfishSource: "server" });

  const headerAnthropic = cleanKey(headers.get(ANTHROPIC_HEADER));
  const cookieAnthropic = cleanKey(cookies?.get(ANTHROPIC_COOKIE)?.value);
  const envAnthropic = serverKey("anthropic");
  if (headerAnthropic) Object.assign(keys, { anthropic: headerAnthropic, anthropicSource: "header" });
  else if (cookieAnthropic) Object.assign(keys, { anthropic: cookieAnthropic, anthropicSource: "browser" });
  else if (envAnthropic) Object.assign(keys, { anthropic: envAnthropic, anthropicSource: "server" });

  return keys;
}

/** One-way fingerprint of the TinyFish key, used to scope sessions to their owner. */
export function ownerIdFor(keys: ApiKeys): string | undefined {
  if (!keys.tinyfish) return undefined;
  return `k_${createHash("sha256").update(`flowlens:${keys.tinyfish}`).digest("hex").slice(0, 32)}`;
}

/** The last four characters, to help someone recognise which key is connected. */
export function keyHint(key: string | undefined): string | undefined {
  return key ? key.slice(-4) : undefined;
}

/**
 * Whether this requester may see a session. A local install is single-user;
 * on a hosted deployment a session is visible only with the key that ran it.
 */
export function canAccess(session: { ownerId?: string }, keys: ApiKeys): boolean {
  if (!isHosted()) return true;
  const owner = ownerIdFor(keys);
  return Boolean(owner && session.ownerId && owner === session.ownerId);
}

/**
 * Rejects cross-site browser requests to endpoints that change state or keys.
 * Requests without an Origin header (server-to-server, MCP clients) pass.
 */
export function isSameOriginOrNonBrowser(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
