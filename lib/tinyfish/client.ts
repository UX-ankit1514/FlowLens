import "server-only";
import { TinyFish } from "@tiny-fish/sdk";
import { z } from "zod";
import { redactSecrets } from "./errors";

export const TINYFISH_API_BASE = "https://agent.tinyfish.ai";

export class MissingApiKeyError extends Error {
  constructor() {
    super("No TinyFish API key is connected");
    this.name = "MissingApiKeyError";
  }
}

/** True when the server itself has a TinyFish key (local install or shared deployment). */
export function isTinyFishConfigured(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY?.trim());
}

/** The caller's key, falling back to the server's own key. */
function apiKey(key?: string): string {
  const resolved = key?.trim() || process.env.TINYFISH_API_KEY?.trim();
  if (!resolved) throw new MissingApiKeyError();
  return resolved;
}

const clients = new Map<string, TinyFish>();

/** Server-side TinyFish SDK client for one API key. Keys never reach the browser. */
export function getTinyFish(key?: string): TinyFish {
  const resolved = apiKey(key);
  let client = clients.get(resolved);
  if (!client) {
    // 15 minutes: longer than the agent's own max duration, so FlowLens
    // controls timeouts (and can recover) rather than the HTTP layer.
    client = new TinyFish({ apiKey: resolved, timeout: 15 * 60 * 1000 });
    if (clients.size > 50) clients.clear();
    clients.set(resolved, client);
  }
  return client;
}

/* ----------------------------------------------------------------------- */
/* REST calls not exposed with full fidelity by SDK v0.11:                  */
/* run steps (screenshots) and cancellation.                                */
/* ----------------------------------------------------------------------- */

const runStepSchema = z.object({
  id: z.string(),
  timestamp: z.string().nullish(),
  status: z.string().nullish(),
  action: z.string().nullish(),
  screenshot: z.string().nullish(),
  duration: z.string().nullish(),
});

const runDetailsSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string(),
      category: z.enum(["SYSTEM_FAILURE", "AGENT_FAILURE", "BILLING_FAILURE", "UNKNOWN"]).catch("UNKNOWN"),
      retry_after: z.number().nullable().default(null),
      help_url: z.string().optional(),
      help_message: z.string().optional(),
    })
    .nullish(),
  streaming_url: z.string().nullish(),
  goal: z.string().nullish(),
  created_at: z.string().nullish(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  steps: z.array(runStepSchema).default([]),
});

export type RunDetails = z.infer<typeof runDetailsSchema>;

/** Validates a run record (used when reopening an earlier TinyFish run). */
export function parseRunDetails(value: unknown): RunDetails {
  return runDetailsSchema.parse(value);
}

async function tinyfishFetch(path: string, key: string | undefined, init?: RequestInit): Promise<Response> {
  return fetch(`${TINYFISH_API_BASE}${path}`, {
    ...init,
    headers: { "X-API-Key": apiKey(key), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

export class RunNotFoundError extends Error {
  constructor(status: number) {
    super(`TinyFish has no run with this id for this API key (HTTP ${status})`);
    this.name = "RunNotFoundError";
  }
}

export async function getRunDetails(runId: string, key?: string): Promise<RunDetails> {
  const res = await tinyfishFetch(`/v1/runs/${encodeURIComponent(runId)}?screenshots=url&html=none`, key, {
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404 || res.status === 403) throw new RunNotFoundError(res.status);
  if (!res.ok) {
    throw new Error(`TinyFish GET /v1/runs returned HTTP ${res.status}`);
  }
  return runDetailsSchema.parse(await res.json());
}

const runSummarySchema = z.object({
  run_id: z.string(),
  status: z.string(),
  goal: z.string().nullish(),
  created_at: z.string().nullish(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  num_of_steps: z.number().nullish(),
});

export type RunSummary = z.infer<typeof runSummarySchema>;

/** Newest-first runs on this TinyFish account (used for hosted history). */
export async function listRuns(key: string | undefined, limit = 50): Promise<RunSummary[]> {
  const res = await tinyfishFetch(`/v1/runs?limit=${limit}&sort_direction=desc`, key, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TinyFish GET /v1/runs returned HTTP ${res.status}`);
  const body = z.object({ data: z.array(z.unknown()).default([]) }).parse(await res.json());
  return body.data.flatMap((item) => {
    const parsed = runSummarySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export type KeyCheck = { ok: true } | { ok: false; reason: string };

/** Confirms a TinyFish key works with a cheap, read-only call. */
export async function verifyTinyFishKey(key: string): Promise<KeyCheck> {
  try {
    const res = await tinyfishFetch("/v1/runs?limit=1", key, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "TinyFish didn't accept this key. Check that you copied the whole key." };
    }
    return { ok: false, reason: `TinyFish couldn't check the key right now (HTTP ${res.status}). Try again.` };
  } catch {
    return { ok: false, reason: "FlowLens couldn't reach TinyFish to check the key. Try again." };
  }
}

export type CancelResult = { status: string; message?: string | null };

export async function cancelRun(runId: string, key?: string): Promise<CancelResult> {
  const res = await tinyfishFetch(`/v1/runs/${encodeURIComponent(runId)}/cancel`, key, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<CancelResult>;
  if (!res.ok) {
    throw new Error(redactSecrets(`TinyFish cancel returned HTTP ${res.status}: ${body.message ?? ""}`));
  }
  return { status: String(body.status ?? "UNKNOWN"), message: body.message };
}

/** Streams a step screenshot captured by TinyFish during the run. */
export async function fetchStepScreenshot(runId: string, stepId: string, key?: string): Promise<Response> {
  return tinyfishFetch(
    `/v1/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/screenshot`,
    key,
    { signal: AbortSignal.timeout(20_000) },
  );
}
