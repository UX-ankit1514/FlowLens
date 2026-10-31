import "server-only";
import type { CompleteEvent } from "@tiny-fish/sdk";
import { sessionStore } from "@/lib/session-store/store";
import { isTerminal } from "@/lib/session-store/transitions";
import { evaluateSession, buildFallbackReport } from "@/lib/evaluator";
import type { SessionError, StepEvidence, TestDefinition, TestSession } from "@/types";
import { cancelRun, getRunDetails, getTinyFish, MissingApiKeyError, type RunDetails } from "./client";
import { mapRunError, mapThrownError } from "./errors";
import { parseFlowLensGoal } from "./import-run";
import { buildAgentGoal } from "./instruction";
import { AGENT_OUTPUT_SCHEMA } from "./output-schema";

/** Upper bound TinyFish enforces on the agent itself. */
export const AGENT_MAX_DURATION_SECONDS = 480;
/** No SSE traffic (incl. heartbeats) for this long → treat the stream as interrupted. */
const STREAM_INACTIVITY_MS = 90_000;
/** Periodically verify the provider status even while SSE heartbeats continue. */
const PROVIDER_RECONCILE_MS = 10_000;
const RECOVERY_POLL_MS = 4_000;
const RECOVERY_DEADLINE_MS = (AGENT_MAX_DURATION_SECONDS + 120) * 1000;
/** After a successful cancel call, how long to wait for the stream to confirm. */
const CANCEL_CONFIRM_MS = 15_000;

/** How often a session without a live event stream re-reads TinyFish's run record. */
const RUN_RECORD_SYNC_MS = 2_500;
/** A live stream that has been silent this long no longer counts as live. */
const LIVE_STREAM_FRESH_MS = 30_000;
const MAX_REMEMBERED_KEYS = 200;
/** Say the run is queued once it has waited this long to start. */
const QUEUE_NOTICE_AFTER_MS = 8_000;
const TERMINAL_RUN_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Runtime = { abort: AbortController; cancelSent: boolean; lastActivity: number };

/** Keys a session's requests carried. Held in memory only, never persisted. */
export type RunKeys = { tinyfish?: string; anthropic?: string };

const globalRuntimes = globalThis as unknown as {
  __flowlensRuntimes?: Map<string, Runtime>;
  __flowlensFinalizations?: Map<string, Promise<void>>;
  __flowlensProviderChecks?: Map<string, Promise<boolean>>;
  __flowlensLastProviderCheck?: Map<string, number>;
  __flowlensSessionKeys?: Map<string, RunKeys>;
  __flowlensRecordSyncs?: Map<string, Promise<void>>;
  __flowlensLastRecordSync?: Map<string, number>;
  __flowlensRehydrations?: Map<string, Promise<TestSession | undefined>>;
  __flowlensRetiredStreams?: Map<string, Set<string>>;
};
const runtimes: Map<string, Runtime> = (globalRuntimes.__flowlensRuntimes ??= new Map());
const finalizations: Map<string, Promise<void>> = (globalRuntimes.__flowlensFinalizations ??= new Map());
const providerChecks: Map<string, Promise<boolean>> = (globalRuntimes.__flowlensProviderChecks ??= new Map());
const lastProviderCheck: Map<string, number> = (globalRuntimes.__flowlensLastProviderCheck ??= new Map());
const sessionKeys: Map<string, RunKeys> = (globalRuntimes.__flowlensSessionKeys ??= new Map());
const recordSyncs: Map<string, Promise<void>> = (globalRuntimes.__flowlensRecordSyncs ??= new Map());
const lastRecordSync: Map<string, number> = (globalRuntimes.__flowlensLastRecordSync ??= new Map());
const rehydrations: Map<string, Promise<TestSession | undefined>> = (globalRuntimes.__flowlensRehydrations ??= new Map());
/** Live-view URLs a session has moved away from (TinyFish restarted the browser). */
const retiredStreams: Map<string, Set<string>> = (globalRuntimes.__flowlensRetiredStreams ??= new Map());

/** Remembers (in memory) the keys to use for a session's background work. */
export function rememberKeys(id: string, keys: RunKeys): void {
  const previous = sessionKeys.get(id) ?? {};
  sessionKeys.delete(id);
  sessionKeys.set(id, {
    tinyfish: keys.tinyfish ?? previous.tinyfish,
    anthropic: keys.anthropic ?? previous.anthropic,
  });
  while (sessionKeys.size > MAX_REMEMBERED_KEYS) {
    const oldest = sessionKeys.keys().next().value;
    if (oldest === undefined) break;
    sessionKeys.delete(oldest);
  }
}

function keysFor(id: string): RunKeys {
  return sessionKeys.get(id) ?? {};
}

/**
 * How runs are followed:
 *  - "stream": one long-lived event stream per run (a local install);
 *  - "poll": the run is queued and followed through TinyFish's run record, so
 *    any server instance can pick it up (hosted, serverless deployments).
 */
export function runMode(): "stream" | "poll" {
  const forced = process.env.FLOWLENS_RUN_MODE;
  if (forced === "poll" || forced === "stream") return forced;
  return process.env.VERCEL ? "poll" : "stream";
}

function runRequest(definition: Omit<TestDefinition, "id">) {
  return {
    url: definition.websiteUrl,
    goal: buildAgentGoal({ ...definition, id: "" }),
    output_schema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    agent_config: { max_duration_seconds: AGENT_MAX_DURATION_SECONDS },
    capture_config: { screenshots: true },
  };
}

type Completion = {
  status: string;
  result: unknown;
  error: CompleteEvent["error"] | RunDetails["error"];
  raw: unknown;
};

/** Starts the TinyFish run in the background. Returns immediately. */
export function startSessionRun(sessionId: string, keys: RunKeys = {}): void {
  rememberKeys(sessionId, keys);
  void runSession(sessionId).catch((error) => {
    console.error(`[flowlens] session ${sessionId} crashed`, error);
    failSession(sessionId, mapThrownError(error));
  });
}

async function runSession(id: string): Promise<void> {
  const session = sessionStore.get(id);
  if (!session) return;
  const { definition } = session;

  sessionStore.transition(id, "STARTING");
  sessionStore.appendEvent(id, {
    type: "SESSION_CREATED",
    description: `Preparing a cloud browser for ${new URL(definition.websiteUrl).hostname}`,
  });

  const runtime: Runtime = { abort: new AbortController(), cancelSent: false, lastActivity: Date.now() };
  runtimes.set(id, runtime);

  let completion: Completion | undefined;
  let streamError: unknown;
  let streamProgress = 0;
  let lastActivity = Date.now();
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  const startReconciliation = () => {
    if (reconcileTimer) return;
    reconcileTimer = setInterval(() => void reconcileSessionRun(id), PROVIDER_RECONCILE_MS);
  };
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > STREAM_INACTIVITY_MS) {
      runtime.abort.abort(new Error("No events from TinyFish for 90 seconds"));
    }
  }, 5_000);

  try {
    const stream = await getTinyFish(keysFor(id).tinyfish).agent.stream(runRequest(definition), {
      signal: runtime.abort.signal,
    });

    for await (const event of stream) {
      lastActivity = Date.now();
      runtime.lastActivity = lastActivity;
      if (event.type === "STARTED") {
        onProviderStarted(id, event.run_id, event.timestamp);
        startReconciliation();
      } else if (event.type === "STREAMING_URL") {
        // STARTED can be lost on a reconnect. Every run-scoped event is also
        // enough to recover the provider id and begin status reconciliation.
        onProviderStarted(id, event.run_id, event.timestamp);
        startReconciliation();
        onStreamingUrl(id, event.streaming_url, event.timestamp);
      } else if (event.type === "PROGRESS") {
        onProviderStarted(id, event.run_id, event.timestamp);
        startReconciliation();
        // When the stream goes quiet, open pages fill the timeline from the run
        // record. Its steps line up one-to-one with these events, so a late
        // event the record already supplied is skipped instead of repeated.
        streamProgress += 1;
        if (progressCount(id) < streamProgress) onProgress(id, event.purpose, event.timestamp);
      } else if (event.type === "COMPLETE") {
        onProviderStarted(id, event.run_id, event.timestamp);
        completion = { status: event.status, result: event.result, error: event.error, raw: event };
        break;
      }
      // HEARTBEAT: activity timestamp updated above; nothing to show.
    }
  } catch (error) {
    streamError = error;
  } finally {
    clearInterval(watchdog);
    if (reconcileTimer) clearInterval(reconcileTimer);
    // The stream is gone: let open pages follow the run record right away
    // instead of waiting for the stream to look stale.
    runtime.lastActivity = 0;
  }

  const current = sessionStore.get(id);
  if (!current || isTerminal(current.executionStatus) || current.executionStatus === "ANALYSING") {
    runtimes.delete(id);
    return;
  }

  if (!completion) {
    if (!current.providerRunId) {
      runtimes.delete(id);
      if (current.cancelRequested) {
        finishCancelled(id, { status: "CANCELLED", result: null, error: null, raw: null });
        return;
      }
      if (streamError instanceof MissingApiKeyError) {
        failSession(id, {
          kind: "CONFIGURATION",
          message: "No TinyFish API key is connected. Open Connections, add your TinyFish key, then run the test again.",
        });
        return;
      }
      failSession(id, mapThrownError(streamError ?? new Error("TinyFish closed the stream before the run started")));
      return;
    }
    completion = await recoverCompletion(id, current.providerRunId, current.cancelRequested);
    if (!completion) {
      runtimes.delete(id);
      failSession(id, {
        kind: "TIMEOUT",
        message:
          "FlowLens lost contact with TinyFish and couldn't confirm the run's result in time. The run may have finished on TinyFish's side; check your TinyFish dashboard.",
      });
      return;
    }
  }

  runtimes.delete(id);
  await finalizeCompletion(id, completion);
}

function onProviderStarted(id: string, runId: string, timestamp: string) {
  const current = sessionStore.get(id);
  if (!current || current.providerRunId) {
    if (current?.providerRunId && current.providerRunId !== runId) {
      console.warn(`[flowlens] session ${id} received events for a second TinyFish run`);
    }
    return;
  }
  sessionStore.update(id, (s) => {
    s.providerRunId = runId;
    s.startedAt = timestamp;
  });
  sessionStore.appendEvent(id, {
    type: "PROVIDER_STARTED",
    description: "TinyFish run started",
    source: "provider",
    timestamp,
  });
  const session = sessionStore.get(id);
  if (session?.cancelRequested) void sendProviderCancel(id);
}

function completionFromRunDetails(details: RunDetails): Completion {
  return {
    status: details.status,
    result: details.result ?? null,
    error: details.error,
    raw: details,
  };
}

/**
 * Reconciles an active FlowLens session with TinyFish's durable run record.
 *
 * This intentionally runs alongside the live event stream: a provider can
 * keep sending heartbeats after its browser has ended while the final COMPLETE
 * event was dropped. The check is globally de-duplicated and throttled so the
 * runner and a connected live page can both use it safely.
 */
export async function reconcileSessionRun(id: string): Promise<boolean> {
  const existing = providerChecks.get(id);
  if (existing) return existing;

  const session = sessionStore.get(id);
  if (
    !session?.providerRunId ||
    isTerminal(session.executionStatus) ||
    session.executionStatus === "ANALYSING"
  ) {
    return false;
  }

  const now = Date.now();
  if (now - (lastProviderCheck.get(id) ?? 0) < PROVIDER_RECONCILE_MS) return false;
  lastProviderCheck.set(id, now);

  const check = (async () => {
    try {
      const details = await getRunDetails(session.providerRunId!, keysFor(id).tinyfish);
      if (details.status !== "COMPLETED" && details.status !== "FAILED" && details.status !== "CANCELLED") {
        return false;
      }

      // Start finalization first. finalizeCompletion claims the session and
      // handleCompletion transitions synchronously to ANALYSING before the
      // stream is aborted, so recovery cannot finalize the run a second time.
      const finalization = finalizeCompletion(id, completionFromRunDetails(details));
      runtimes.get(id)?.abort.abort(new Error("TinyFish terminal status confirmed by reconciliation"));
      await finalization;
      return true;
    } catch (error) {
      console.warn(`[flowlens] could not reconcile session ${id} with TinyFish`, error);
      return false;
    }
  })();

  providerChecks.set(id, check);
  try {
    return await check;
  } finally {
    if (providerChecks.get(id) === check) providerChecks.delete(id);
  }
}

/** Ensures completion and report generation happen once per session. */
async function finalizeCompletion(id: string, completion: Completion): Promise<void> {
  const existing = finalizations.get(id);
  if (existing) return existing;
  const session = sessionStore.get(id);
  if (!session || isTerminal(session.executionStatus) || session.executionStatus === "ANALYSING") return;

  let resolveJob!: () => void;
  let rejectJob!: (reason: unknown) => void;
  const job = new Promise<void>((resolve, reject) => {
    resolveJob = resolve;
    rejectJob = reject;
  });
  finalizations.set(id, job);
  // Calling an async function runs synchronously until its first await. The
  // finalization claim is therefore visible before handleCompletion changes
  // the session to ANALYSING, and both are visible before callers can abort
  // the event stream.
  void handleCompletion(id, completion).then(resolveJob, rejectJob);
  try {
    await job;
  } finally {
    if (finalizations.get(id) === job) finalizations.delete(id);
    lastProviderCheck.delete(id);
  }
}

/**
 * Points the live view at the agent's browser. TinyFish sometimes restarts a
 * stalled agent in a fresh browser mid-run; the old stream then shows "session
 * completed" while the run goes on, so the view must follow the newest one.
 */
function onStreamingUrl(id: string, url: string, timestamp: string) {
  if (!/^https:\/\//i.test(url)) {
    console.warn("[flowlens] ignoring non-https streaming URL from TinyFish");
    return;
  }
  const session = sessionStore.get(id);
  if (!session || isTerminal(session.executionStatus) || session.executionStatus === "ANALYSING") return;
  const previous = session.streamingUrl;
  if (previous === url) return;
  const retired = retiredStreams.get(id) ?? new Set<string>();
  // A lagging run record can still name a browser that was already replaced.
  if (retired.has(url)) return;
  if (previous) {
    retired.add(previous);
    retiredStreams.set(id, retired);
  }

  sessionStore.transition(id, "RUNNING", (s) => {
    s.streamingUrl = url;
    s.liveViewStatus = "AVAILABLE";
  });
  sessionStore.appendEvent(id, {
    type: "LIVE_VIEW_AVAILABLE",
    description: previous
      ? "TinyFish restarted the agent in a new browser. The live view has switched to it."
      : "Live browser view connected",
    source: "provider",
    tone: previous ? "notice" : undefined,
    timestamp,
  });
}

function onProgress(id: string, purpose: string, timestamp: string) {
  const session = sessionStore.get(id);
  if (session?.executionStatus === "STARTING") sessionStore.transition(id, "RUNNING");
  sessionStore.appendEvent(id, {
    type: "AGENT_PROGRESS",
    description: purpose,
    source: "provider",
    timestamp,
  });
}

/**
 * Stream interrupted after the run started: follow the run record until it's
 * terminal. TinyFish's live stream routinely closes partway through longer
 * runs; the run record carries the same steps, so the designer sees no gap and
 * the timeline doesn't get a warning for what is only a change of transport.
 */
async function recoverCompletion(id: string, runId: string, cancelling: boolean): Promise<Completion | undefined> {
  console.info(`[flowlens] live stream for run ${runId} ended early; following the run record`);
  if (cancelling) {
    sessionStore.appendEvent(id, {
      type: "CONNECTION_INTERRUPTED",
      description: "Waiting for TinyFish to confirm the stop…",
      tone: "notice",
    });
  }
  const deadline = Date.now() + RECOVERY_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      const details = await getRunDetails(runId, keysFor(id).tinyfish);
      // Keep the timeline moving even when no page is open to pull it,
      // including the agent's last steps before the run ended.
      applyRunRecord(id, details);
      if (details.status === "COMPLETED" || details.status === "FAILED" || details.status === "CANCELLED") {
        return { status: details.status, result: details.result ?? null, error: details.error, raw: details };
      }
    } catch (error) {
      console.warn(`[flowlens] polling run ${runId} failed`, error);
    }
    await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS));
  }
  return undefined;
}

async function handleCompletion(id: string, completion: Completion) {
  const session = sessionStore.get(id);
  if (!session) return;

  sessionStore.update(id, (s) => {
    s.rawResult = completion.raw;
    s.providerStatus = completion.status;
    s.liveViewStatus = s.streamingUrl ? "ENDED" : s.liveViewStatus;
  });

  if (completion.status === "CANCELLED") {
    await attachSteps(id);
    finishCancelled(id, completion);
    return;
  }

  if (completion.status !== "COMPLETED") {
    // The SSE COMPLETE event can arrive with error: null even when TinyFish
    // recorded a reason; the run record has it.
    let runError = completion.error ?? null;
    if (completion.status === "FAILED" && !runError && session.providerRunId) {
      runError = await getRunDetails(session.providerRunId, keysFor(id).tinyfish)
        .then((d) => d.error ?? null)
        .catch(() => null);
    }
    const error = completion.status === "FAILED"
      ? mapRunError(runError)
      : { kind: "UNKNOWN" as const, message: `TinyFish ended the run with status ${completion.status}.` };
    sessionStore.appendEvent(id, {
      type: "RUN_FAILED",
      description: `Run failed: ${error.providerMessage ?? error.message}`,
      source: "provider",
      tone: "negative",
    });
    await attachSteps(id);
    failSession(id, error);
    return;
  }

  sessionStore.appendEvent(id, {
    type: "RUN_COMPLETED",
    description: session.cancelRequested
      ? "TinyFish finished the run before the stop request took effect"
      : "TinyFish finished the run",
    source: "provider",
    tone: "positive",
  });
  sessionStore.transition(id, "ANALYSING");
  sessionStore.appendEvent(id, { type: "ANALYSIS_STARTED", description: "Analysing the recorded journey" });

  await attachSteps(id);

  const latest = sessionStore.get(id)!;
  let report;
  try {
    report = await evaluateSession(latest, keysFor(id));
  } catch (error) {
    console.error(`[flowlens] evaluation failed for ${id}`, error);
    report = buildFallbackReport(latest, "The analysis step failed unexpectedly; this report lists the recorded evidence only.");
  }

  sessionStore.transition(id, "COMPLETED", (s) => {
    s.report = report;
    s.taskOutcome = report.taskOutcome;
    s.finishedAt = new Date().toISOString();
  });
  sessionStore.appendEvent(id, {
    type: "REPORT_READY",
    description: "UX report ready",
    tone: "positive",
  });
}

function finishCancelled(id: string, completion: Completion) {
  const session = sessionStore.get(id);
  if (!session || isTerminal(session.executionStatus)) return;
  sessionStore.appendEvent(id, {
    type: "RUN_CANCELLED",
    description: "Test stopped. The run was cancelled before the agent finished.",
    source: completion.raw ? "provider" : "flowlens",
    tone: "notice",
  });
  sessionStore.transition(id, "CANCELLED", (s) => {
    s.liveViewStatus = s.streamingUrl ? "ENDED" : s.liveViewStatus;
    s.finishedAt = new Date().toISOString();
    s.taskOutcome = "NOT_VERIFIED";
    s.report = buildFallbackReport(s, "The designer stopped this session before the agent finished.");
  });
}

function failSession(id: string, error: SessionError) {
  const session = sessionStore.get(id);
  if (!session || isTerminal(session.executionStatus)) return;
  sessionStore.transition(id, "FAILED", (s) => {
    s.error = error;
    s.liveViewStatus = s.streamingUrl ? "ENDED" : s.liveViewStatus;
    s.finishedAt = new Date().toISOString();
    s.taskOutcome = "NOT_VERIFIED";
    // Keep whatever was observed (if the run got going) so it can be inspected.
    if (s.providerRunId) s.report = buildFallbackReport(s, error.message);
  });
}

/** Fetches the step list (with screenshot availability) recorded by TinyFish. */
async function attachSteps(id: string) {
  const session = sessionStore.get(id);
  if (!session?.providerRunId) return;
  let details: RunDetails | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      details = await getRunDetails(session.providerRunId, keysFor(id).tinyfish);
      if (details.steps.length > 0) break;
    } catch (error) {
      console.warn(`[flowlens] could not fetch steps for ${session.providerRunId}`, error);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!details) return;

  const steps: StepEvidence[] = details.steps.map((step, index) => ({
    ref: `S${index + 1}`,
    stepId: step.id,
    timestamp: step.timestamp ?? undefined,
    action: step.action ?? "",
    status: step.status ?? undefined,
    duration: step.duration ?? undefined,
    hasScreenshot: Boolean(step.screenshot),
  }));

  sessionStore.update(id, (s) => {
    s.steps = steps;
    linkStepsToEvents(s, steps);
  });
}

/** Pairs each recorded step with the progress event that announced it. */
export function linkStepsToEvents(session: Pick<TestSession, "events">, steps: StepEvidence[]) {
  let cursor = 0;
  const progress = session.events.filter((e) => e.type === "AGENT_PROGRESS");
  for (const step of steps) {
    const index = progress.findIndex((e, i) => i >= cursor && !e.evidenceRef && e.description.trim() === step.action.trim());
    if (index >= 0) {
      progress[index].evidenceRef = step.ref;
      cursor = index + 1;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Following a run through TinyFish's run record                             */
/* ------------------------------------------------------------------------ */

/**
 * Queues a TinyFish run and creates its session. The session id is the
 * TinyFish run id, so any server instance can later rebuild the session from
 * the run record with the same key. Nothing keeps running in the background.
 */
export async function startPolledRun(
  definition: Omit<TestDefinition, "id">,
  keys: RunKeys,
  ownerId?: string,
): Promise<TestSession> {
  const queued = await getTinyFish(keys.tinyfish).agent.queue(runRequest(definition));
  if (!queued.run_id) throw new RunStartError(mapRunError(queued.error ?? null));
  const id = queued.run_id;
  sessionStore.create(definition, { id, ownerId });
  rememberKeys(id, keys);
  sessionStore.transition(id, "STARTING", (s) => {
    s.providerRunId = id;
  });
  sessionStore.appendEvent(id, {
    type: "SESSION_CREATED",
    description: `Preparing a cloud browser for ${new URL(definition.websiteUrl).hostname}`,
  });
  return sessionStore.get(id)!;
}

export class RunStartError extends Error {
  constructor(readonly sessionError: SessionError) {
    super(sessionError.message);
    this.name = "RunStartError";
  }
}

/** True while this server instance is receiving the run's live event stream. */
function hasLiveStream(id: string): boolean {
  const runtime = runtimes.get(id);
  return Boolean(runtime && Date.now() - runtime.lastActivity < LIVE_STREAM_FRESH_MS);
}

/**
 * Brings a session up to date: through the live stream when this instance has
 * one, otherwise by reading TinyFish's run record.
 */
export async function refreshSessionRun(id: string): Promise<void> {
  if (hasLiveStream(id)) {
    await reconcileSessionRun(id);
    return;
  }
  await syncSessionRun(id);
}

/** Applies TinyFish's run record to a session and finalizes it once the run has ended. */
export async function syncSessionRun(id: string, prefetched?: RunDetails): Promise<void> {
  const running = recordSyncs.get(id);
  if (running) return running;
  const session = sessionStore.get(id);
  if (!session?.providerRunId || isTerminal(session.executionStatus) || session.executionStatus === "ANALYSING") {
    return;
  }
  const now = Date.now();
  if (!prefetched && now - (lastRecordSync.get(id) ?? 0) < RUN_RECORD_SYNC_MS) return;
  lastRecordSync.set(id, now);

  const job = (async () => {
    try {
      const details = prefetched ?? (await getRunDetails(session.providerRunId!, keysFor(id).tinyfish));
      applyRunRecord(id, details);
      if (TERMINAL_RUN_STATUSES.has(details.status)) {
        await finalizeCompletion(id, completionFromRunDetails(details));
      }
    } catch (error) {
      console.warn(`[flowlens] could not read the run record for session ${id}`, error);
    }
  })();
  recordSyncs.set(id, job);
  try {
    await job;
  } finally {
    if (recordSyncs.get(id) === job) recordSyncs.delete(id);
  }
}

/** Turns new parts of the run record into the same timeline events the live stream produces. */
function applyRunRecord(id: string, details: RunDetails) {
  const session = sessionStore.get(id);
  if (!session || isTerminal(session.executionStatus) || session.executionStatus === "ANALYSING") return;
  const ended = TERMINAL_RUN_STATUSES.has(details.status);
  const now = new Date().toISOString();

  // TinyFish holds a run in its queue while the account's concurrent runs are busy.
  if (
    details.status === "PENDING" &&
    Date.now() - Date.parse(session.createdAt) > QUEUE_NOTICE_AFTER_MS &&
    !session.events.some((e) => e.type === "RUN_QUEUED")
  ) {
    sessionStore.appendEvent(id, {
      type: "RUN_QUEUED",
      description: "Waiting in TinyFish's queue for a free browser. Your TinyFish plan runs a limited number of tests at once.",
      source: "provider",
      tone: "notice",
    });
  }

  const started = details.started_at ?? (details.status !== "PENDING" ? now : undefined);
  if (started && !session.startedAt) {
    sessionStore.update(id, (s) => {
      s.startedAt = started;
    });
    sessionStore.appendEvent(id, {
      type: "PROVIDER_STARTED",
      description: "TinyFish run started",
      source: "provider",
      timestamp: started,
    });
  }

  // The run record's steps are the agent's progress updates. Once the run has
  // ended, its last step is TinyFish's own end marker, not an agent action.
  const steps = ended && details.steps.length > 0 ? details.steps.slice(0, -1) : details.steps;
  const unseen = steps.slice(progressCount(id));

  // Follow a browser restart too, not just the first stream. Dated with the
  // first step it brings so the timeline's times stay in order.
  if (!ended && details.streaming_url) {
    onStreamingUrl(id, details.streaming_url, unseen[0]?.timestamp ?? now);
  }

  for (const step of unseen) {
    onProgress(id, step.action?.trim() || "Agent step", step.timestamp ?? now);
  }
}

/** Agent steps already on the session's timeline. */
function progressCount(id: string): number {
  return (sessionStore.get(id)?.events ?? []).filter((e) => e.type === "AGENT_PROGRESS").length;
}

/**
 * Rebuilds a session this instance doesn't hold (another server instance ran
 * it, or FlowLens restarted) from TinyFish's run record. Only FlowLens runs on
 * the caller's own TinyFish account can be opened this way.
 */
export async function rehydrateSession(
  id: string,
  keys: RunKeys,
  ownerId?: string,
): Promise<{ session: TestSession; settled: Promise<void> } | undefined> {
  if (!RUN_ID.test(id) || !keys.tinyfish) return undefined;
  let pending = rehydrations.get(id);
  if (!pending) {
    pending = (async () => {
      const details = await getRunDetails(id, keys.tinyfish).catch(() => undefined);
      const definition = details ? parseFlowLensGoal(details.goal ?? "") : undefined;
      if (!details || !definition) return undefined;
      const existing = sessionStore.get(id);
      if (existing) return existing;
      sessionStore.create(definition, { id, ownerId, createdAt: details.created_at ?? undefined });
      rememberKeys(id, keys);
      sessionStore.transition(id, "STARTING", (s) => {
        s.providerRunId = id;
      });
      sessionStore.appendEvent(id, {
        type: "SESSION_CREATED",
        description: `Preparing a cloud browser for ${new URL(definition.websiteUrl).hostname}`,
        timestamp: details.created_at ?? undefined,
      });
      lastRecordSync.set(id, 0);
      void syncSessionRun(id, details);
      return sessionStore.get(id);
    })();
    rehydrations.set(id, pending);
    void pending.finally(() => {
      if (rehydrations.get(id) === pending) rehydrations.delete(id);
    });
  }
  const session = await pending;
  if (!session) return undefined;
  return { session, settled: recordSyncs.get(id) ?? finalizations.get(id) ?? Promise.resolve() };
}

/** Resolves when the session's current sync or report generation finishes. */
export function sessionWork(id: string): Promise<void> {
  return recordSyncs.get(id) ?? finalizations.get(id) ?? Promise.resolve();
}

/* ------------------------------------------------------------------------ */
/* Cancellation                                                              */
/* ------------------------------------------------------------------------ */

export type CancelOutcome = { accepted: boolean; message: string };

export async function requestCancel(id: string): Promise<CancelOutcome> {
  const session = sessionStore.get(id);
  if (!session) return { accepted: false, message: "Session not found." };
  if (isTerminal(session.executionStatus)) {
    return { accepted: false, message: "This session has already finished." };
  }
  if (session.executionStatus === "ANALYSING") {
    return { accepted: false, message: "The run already finished; the report is being prepared." };
  }
  if (!session.cancelRequested) {
    sessionStore.update(id, (s) => {
      s.cancelRequested = true;
    });
    sessionStore.appendEvent(id, { type: "CANCEL_REQUESTED", description: "Stop requested", tone: "notice" });
  }
  if (session.providerRunId) {
    return sendProviderCancel(id);
  }
  // The provider hasn't assigned a run id yet; onProviderStarted will cancel it.
  return { accepted: true, message: "Stopping as soon as the run starts." };
}

async function sendProviderCancel(id: string): Promise<CancelOutcome> {
  const session = sessionStore.get(id);
  const runtime = runtimes.get(id);
  if (!session?.providerRunId) return { accepted: true, message: "Stopping…" };
  if (runtime?.cancelSent) return { accepted: true, message: "Stopping…" };
  if (runtime) runtime.cancelSent = true;

  try {
    const result = await cancelRun(session.providerRunId, keysFor(id).tinyfish);
    // The SSE stream normally delivers COMPLETE(CANCELLED) right after this.
    // If it doesn't, stop listening and let recovery confirm via the REST API.
    setTimeout(() => {
      const s = sessionStore.get(id);
      if (s && !isTerminal(s.executionStatus) && s.executionStatus !== "ANALYSING") {
        runtimes.get(id)?.abort.abort(new Error("Cancel confirmation timeout"));
      }
    }, CANCEL_CONFIRM_MS);
    return { accepted: true, message: result.status === "CANCELLED" ? "Stopping…" : (result.message ?? "Stopping…") };
  } catch (error) {
    if (runtime) runtime.cancelSent = false;
    console.error(`[flowlens] cancel failed for ${session.providerRunId}`, error);
    sessionStore.appendEvent(id, {
      type: "CANCEL_REQUESTED",
      description: "TinyFish didn't accept the stop request. Try again.",
      tone: "negative",
    });
    sessionStore.update(id, (s) => {
      s.cancelRequested = false;
    });
    return { accepted: false, message: "TinyFish didn't accept the stop request. Try again." };
  }
}
