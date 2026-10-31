import type { NextRequest } from "next/server";
import { keysFromRequest } from "@/lib/keys";
import { snapshotOf } from "@/lib/session-store/snapshot";
import { sessionStore, type StoreChange } from "@/lib/session-store/store";
import { isTerminal } from "@/lib/session-store/transitions";
import { loadSession } from "@/lib/sessions/service";
import { refreshSessionRun } from "@/lib/tinyfish/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;
/** How often to bring the session up to date (the runner throttles provider calls). */
const PROVIDER_REFRESH_MS = 2_500;

/**
 * GET /api/sessions/:id/events — Server-Sent Events.
 *
 * Replays every timeline event after the client's Last-Event-ID (or ?after=),
 * then streams new events live. EventSource reconnects automatically and
 * resumes from the last sequence it saw, so brief disconnections lose nothing.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  const session = await loadSession(id, keysFromRequest(request));
  if (!session) return new Response("Session not found", { status: 404 });

  const lastEventId = request.headers.get("last-event-id") ?? request.nextUrl.searchParams.get("after");
  const after = Number.parseInt(lastEventId ?? "0", 10) || 0;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const sendEvent = (name: string, data: unknown, eventId?: number) => {
        send(`${eventId !== undefined ? `id: ${eventId}\n` : ""}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const sendSnapshotAndMaybeEnd = () => {
        const current = sessionStore.get(id);
        if (!current) return close();
        sendEvent("snapshot", snapshotOf(current));
        if (isTerminal(current.executionStatus)) {
          sendEvent("end", { executionStatus: current.executionStatus });
          close();
        }
      };

      function close() {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      send("retry: 3000\n\n");
      for (const event of session.events) {
        if (event.sequence > after) sendEvent("timeline", event, event.sequence);
      }

      const unsubscribe = sessionStore.subscribe(id, (change: StoreChange) => {
        if (change.kind === "event") sendEvent("timeline", change.event, change.event.sequence);
        else sendSnapshotAndMaybeEnd();
      });
      const keepalive = setInterval(() => send(`: keepalive\n\n`), KEEPALIVE_MS);
      // Follows the run through TinyFish's run record whenever this server
      // instance isn't receiving its live stream (hosted deployments, restarts,
      // hot reloads), and confirms the final status either way.
      const providerReconcile = setInterval(() => void refreshSessionRun(id), PROVIDER_REFRESH_MS);
      const onAbort = () => close();
      request.signal.addEventListener("abort", onAbort);

      cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
        clearInterval(providerReconcile);
        request.signal.removeEventListener("abort", onAbort);
      };

      sendSnapshotAndMaybeEnd();
      void refreshSessionRun(id);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
