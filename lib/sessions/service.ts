import "server-only";
import { randomUUID } from "node:crypto";
import { ensureCurrentReport } from "@/lib/evaluator/upgrade";
import { canAccess, isHosted, ownerIdFor, type ApiKeys } from "@/lib/keys";
import { collectFieldErrors, suggestSessionName, testInputSchema, type FieldErrors } from "@/lib/schemas/test-input";
import { validatePublicWebsite } from "@/lib/security/dns";
import { recentSummaryOf } from "@/lib/session-store/snapshot";
import { sessionStore } from "@/lib/session-store/store";
import { listRuns } from "@/lib/tinyfish/client";
import { mapThrownError } from "@/lib/tinyfish/errors";
import { parseFlowLensGoal } from "@/lib/tinyfish/import-run";
import {
  rehydrateSession,
  rememberKeys,
  runMode,
  RunStartError,
  startPolledRun,
  startSessionRun,
} from "@/lib/tinyfish/runner";
import type { ExecutionStatus, RecentSessionSummary, TestSession } from "@/types";

/**
 * Session operations shared by the web app's API and the MCP endpoint used by
 * Claude Code and Codex. Every operation is scoped to the caller's own keys.
 */

export const NO_TINYFISH_KEY =
  "No TinyFish API key is connected. Open Connections in FlowLens and add your TinyFish key (or send it in the X-TinyFish-Api-Key header).";

export class StartTestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = "StartTestError";
  }
}

/** Validates a test definition and starts a real TinyFish run on the caller's account. */
export async function startTest(input: unknown, keys: ApiKeys): Promise<TestSession> {
  if (!keys.tinyfish) throw new StartTestError(NO_TINYFISH_KEY, 503);

  const parsed = testInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new StartTestError("Some fields need attention.", 422, collectFieldErrors(parsed.error));
  }
  const data = parsed.data;

  const destination = await validatePublicWebsite(data.websiteUrl);
  if (!destination.ok) {
    throw new StartTestError(destination.reason, 422, { websiteUrl: destination.reason });
  }

  const featureContext =
    data.featureContext && Object.values(data.featureContext).some(Boolean) ? data.featureContext : undefined;
  const definition = {
    websiteUrl: destination.url,
    sessionName: data.sessionName ?? suggestSessionName(data.goal),
    persona: { id: randomUUID(), description: data.persona },
    goal: data.goal,
    successCriteria: data.successCriteria,
    featureContext,
  };
  const ownerId = ownerIdFor(keys);
  const runKeys = { tinyfish: keys.tinyfish, anthropic: keys.anthropic };

  if (runMode() === "poll") {
    try {
      return await startPolledRun(definition, runKeys, ownerId);
    } catch (error) {
      const mapped = error instanceof RunStartError ? error.sessionError : mapThrownError(error);
      throw new StartTestError(mapped.message, 502);
    }
  }

  const session = sessionStore.create(definition, { ownerId });
  startSessionRun(session.id, runKeys);
  return session;
}

/**
 * Loads a session the caller may see. If this server instance doesn't hold it
 * (hosted deployments, or after a restart), it's rebuilt from TinyFish's run
 * record using the caller's key. `waitMs` gives a just-rebuilt session time to
 * finish its report before returning.
 */
export async function loadSession(
  id: string,
  keys: ApiKeys,
  { waitMs = 0 }: { waitMs?: number } = {},
): Promise<TestSession | undefined> {
  const existing = sessionStore.get(id);
  if (existing) {
    if (!canAccess(existing, keys)) return undefined;
    if (keys.tinyfish) rememberKeys(id, { tinyfish: keys.tinyfish, anthropic: keys.anthropic });
    return ensureCurrentReport(id);
  }
  const rebuilt = await rehydrateSession(id, { tinyfish: keys.tinyfish, anthropic: keys.anthropic }, ownerIdFor(keys));
  if (!rebuilt) return undefined;
  if (waitMs > 0) {
    await Promise.race([rebuilt.settled, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  }
  return sessionStore.get(id);
}

const RUN_STATUS_VIEW: Record<string, ExecutionStatus> = {
  PENDING: "STARTING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

/**
 * Newest-first history for the caller. A local install reads its saved
 * sessions; a hosted deployment also lists FlowLens runs from the caller's
 * TinyFish account, so history survives restarts without a database.
 */
export async function listRecentSessions(keys: ApiKeys, limit = 50): Promise<RecentSessionSummary[]> {
  const local = sessionStore.listRecent(limit).filter((s) => canAccess(s, keys));
  const summaries = new Map<string, RecentSessionSummary>(local.map((s) => [s.id, recentSummaryOf(s)]));
  const knownRuns = new Set(local.map((s) => s.providerRunId).filter(Boolean));

  if ((isHosted() || runMode() === "poll") && keys.tinyfish) {
    const runs = await listRuns(keys.tinyfish, limit).catch((error) => {
      console.warn("[flowlens] could not list TinyFish runs", error);
      return [];
    });
    for (const run of runs) {
      if (summaries.has(run.run_id) || knownRuns.has(run.run_id)) continue;
      const definition = parseFlowLensGoal(run.goal ?? "");
      if (!definition) continue;
      const executionStatus = RUN_STATUS_VIEW[run.status] ?? "FAILED";
      summaries.set(run.run_id, {
        id: run.run_id,
        title: suggestSessionName(definition.goal) || definition.goal,
        websiteUrl: definition.websiteUrl,
        goal: definition.goal,
        executionStatus,
        createdAt: run.created_at ?? run.started_at ?? new Date(0).toISOString(),
        finishedAt: run.finished_at ?? undefined,
        // The report is built from the run record when it's opened.
        hasReport: executionStatus === "COMPLETED",
        eventCount: 0,
        stepCount: run.num_of_steps ?? 0,
      });
    }
  }

  return [...summaries.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}
