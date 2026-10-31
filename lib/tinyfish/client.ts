import "server-only";
import { TinyFish } from "@tiny-fish/sdk";
import { z } from "zod";
import { redactSecrets } from "./errors";

export const TINYFISH_API_BASE = "https://agent.tinyfish.ai";

export class MissingApiKeyError extends Error {
  constructor() {
    super("TINYFISH_API_KEY is not set");
    this.name = "MissingApiKeyError";
  }
}

export function isTinyFishConfigured(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key) throw new MissingApiKeyError();
  return key;
}

let client: TinyFish | undefined;

/** Server-side TinyFish SDK client. The key never leaves the server. */
export function getTinyFish(): TinyFish {
  if (!client) {
    // 15 minutes: longer than the agent's own max duration, so FlowLens
    // controls timeouts (and can recover) rather than the HTTP layer.
    client = new TinyFish({ apiKey: apiKey(), timeout: 15 * 60 * 1000 });
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

async function tinyfishFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${TINYFISH_API_BASE}${path}`, {
    ...init,
    headers: { "X-API-Key": apiKey(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

export async function getRunDetails(runId: string): Promise<RunDetails> {
  const res = await tinyfishFetch(`/v1/runs/${encodeURIComponent(runId)}?screenshots=url&html=none`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`TinyFish GET /v1/runs returned HTTP ${res.status}`);
  }
  return runDetailsSchema.parse(await res.json());
}

export type CancelResult = { status: string; message?: string | null };

export async function cancelRun(runId: string): Promise<CancelResult> {
  const res = await tinyfishFetch(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
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
export async function fetchStepScreenshot(runId: string, stepId: string): Promise<Response> {
  return tinyfishFetch(
    `/v1/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/screenshot`,
    { signal: AbortSignal.timeout(20_000) },
  );
}
