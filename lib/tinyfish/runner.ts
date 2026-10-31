import "server-only";
import type { CompleteEvent } from "@tiny-fish/sdk";
import { sessionStore } from "@/lib/session-store/store";
import { isTerminal } from "@/lib/session-store/transitions";
import { evaluateSession, buildFallbackReport } from "@/lib/evaluator";
import type { SessionError, StepEvidence, TestSession } from "@/types";
import { cancelRun, getRunDetails, getTinyFish, MissingApiKeyError, type RunDetails } from "./client";
import { mapRunError, mapThrownError } from "./errors";
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

type Runtime = { abort: AbortController; cancelSent: boolean };

const globalRuntimes = globalThis as unknown as {
  __flowlensRuntimes?: Map<string, Runtime>;
  __flowlensFinalizations?: Map<string, Promise<void>>;
  __flowlensProviderChecks?: Map<string, Promise<boolean>>;
  __flowlensLastProviderCheck?: Map<string, number>;
};
const runtimes: Map<string, Runtime> = (globalRuntimes.__flowlensRuntimes ??= new Map());
const finalizations: Map<string, Promise<void>> = (globalRuntimes.__flowlensFinalizations ??= new Map());
const providerChecks: Map<string, Promise<boolean>> = (globalRuntimes.__flowlensProviderChecks ??= new Map());
const lastProviderCheck: Map<string, number> = (globalRuntimes.__flowlensLastProviderCheck ??= new Map());

type Completion = {
  status: string;
  result: unknown;
  error: CompleteEvent["error"] | RunDetails["error"];
  raw: unknown;
};

/** Starts the TinyFish run in the background. Returns immediately. */
export function startSessionRun(sessionId: string): void {
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

  const runtime: Runtime = { abort: new AbortController(), cancelSent: false };
  runtimes.set(id, runtime);

  let completion: Completion | undefined;
  let streamError: unknown;
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
    const stream = await getTinyFish().agent.stream(
      {
        url: definition.websiteUrl,
        goal: buildAgentGoal(definition),
        output_schema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        agent_config: { max_duration_seconds: AGENT_MAX_DURATION_SECONDS },
        capture_config: { screenshots: true },
      },
      { signal: runtime.abort.signal },
    );

    for await (const event of stream) {
      lastActivity = Date.now();
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
        onProgress(id, event.purpose, event.timestamp);
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
          message: "TINYFISH_API_KEY is not set. Add it to .env.local and restart FlowLens.",
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
      const details = await getRunDetails(session.providerRunId!);
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

function onStreamingUrl(id: string, url: string, timestamp: string) {
  if (!/^https:\/\//i.test(url)) {
    console.warn("[flowlens] ignoring non-https streaming URL from TinyFish");
    return;
  }
  sessionStore.transition(id, "RUNNING", (s) => {
    s.streamingUrl = url;
    s.liveViewStatus = "AVAILABLE";
  });
  sessionStore.appendEvent(id, {
    type: "LIVE_VIEW_AVAILABLE",
    description: "Live browser view connected",
    source: "provider",
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

/** Stream interrupted after the run started: poll the run until it's terminal. */
async function recoverCompletion(id: string, runId: string, cancelling: boolean): Promise<Completion | undefined> {
  sessionStore.appendEvent(id, {
    type: "CONNECTION_INTERRUPTED",
    description: cancelling
      ? "Waiting for TinyFish to confirm the stop…"
      : "Lost the live event stream from TinyFish. Checking the run status instead…",
    tone: "notice",
  });
  const deadline = Date.now() + RECOVERY_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      const details = await getRunDetails(runId);
      if (details.status === "COMPLETED" || details.status === "FAILED" || details.status === "CANCELLED") {
        sessionStore.appendEvent(id, {
          type: "CONNECTION_RECOVERED",
          description: "Run status retrieved from TinyFish",
        });
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
      runError = await getRunDetails(session.providerRunId)
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
    report = await evaluateSession(latest);
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
      details = await getRunDetails(session.providerRunId);
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
    const result = await cancelRun(session.providerRunId);
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
