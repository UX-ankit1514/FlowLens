import "server-only";
import { AI_MODEL } from "@/lib/evaluator/ai-evaluator";
import { isHosted, keyHint, type ApiKeys } from "@/lib/keys";
import type { AppConfigView } from "@/types";

/** What this requester has connected — never the keys themselves. */
export function connectionView(keys: ApiKeys): AppConfigView {
  const ai = Boolean(keys.anthropic);
  return {
    tinyfishConfigured: Boolean(keys.tinyfish),
    aiInterpretationEnabled: ai,
    aiModel: ai ? AI_MODEL : undefined,
    tinyfish: {
      connected: Boolean(keys.tinyfish),
      source: keys.tinyfishSource,
      hint: keys.tinyfishSource === "server" ? undefined : keyHint(keys.tinyfish),
    },
    claude: {
      connected: ai,
      source: keys.anthropicSource,
      hint: keys.anthropicSource === "server" ? undefined : keyHint(keys.anthropic),
    },
    hosted: isHosted(),
  };
}

export type ClaudeKeyCheck = { ok: true } | { ok: false; reason: string };

/** Confirms a Claude API key works with a free, read-only call. */
export async function verifyClaudeKey(key: string): Promise<ClaudeKeyCheck> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Claude didn't accept this key. Check that you copied the whole key." };
    }
    return { ok: false, reason: `Claude couldn't check the key right now (HTTP ${res.status}). Try again.` };
  } catch {
    return { ok: false, reason: "FlowLens couldn't reach Claude to check the key. Try again." };
  }
}
