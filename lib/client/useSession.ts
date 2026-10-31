"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "@/lib/session-store/snapshot";
import type { SessionEvent, TestSession } from "@/types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export type SessionState = {
  session?: TestSession;
  loadError?: "not-found" | "network";
  connection: ConnectionState;
};

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function mergeEvents(existing: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  if (incoming.length === 0) return existing;
  const bySeq = new Map(existing.map((e) => [e.sequence, e]));
  for (const e of incoming) bySeq.set(e.sequence, e);
  return [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Loads a session and keeps it live via Server-Sent Events.
 * EventSource reconnects on its own and resumes from the last event id, so a
 * dropped connection replays anything missed. When the run reaches a terminal
 * state, the full session (report, step evidence) is re-fetched once.
 */
export function useSession(id: string) {
  const [state, setState] = useState<SessionState>({ connection: "connecting" });
  const sourceRef = useRef<EventSource | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setState((s) => ({ ...s, loadError: "not-found", connection: "closed" }));
        return undefined;
      }
      if (!res.ok) throw new Error(String(res.status));
      const session = (await res.json()) as TestSession;
      setState((s) => ({
        ...s,
        loadError: undefined,
        session: s.session ? { ...session, events: mergeEvents(s.session.events, session.events) } : session,
      }));
      return session;
    } catch {
      setState((s) => ({ ...s, loadError: s.session ? undefined : "network" }));
      return undefined;
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initial = await refetch();
      if (cancelled || !initial) return;
      if (TERMINAL.has(initial.executionStatus)) {
        setState((s) => ({ ...s, connection: "closed" }));
        return;
      }

      const source = new EventSource(`/api/sessions/${id}/events?after=${initial.events.length}`);
      sourceRef.current = source;

      source.onopen = () => setState((s) => ({ ...s, connection: "open" }));
      source.onerror = () => {
        setState((s) => ({
          ...s,
          connection: source.readyState === EventSource.CLOSED ? "closed" : "reconnecting",
        }));
      };
      source.addEventListener("timeline", (message) => {
        const event = JSON.parse((message as MessageEvent).data) as SessionEvent;
        setState((s) =>
          s.session ? { ...s, session: { ...s.session, events: mergeEvents(s.session.events, [event]) } } : s,
        );
      });
      source.addEventListener("snapshot", (message) => {
        const snapshot = JSON.parse((message as MessageEvent).data) as SessionSnapshot;
        setState((s) => {
          if (!s.session) return s;
          const { hasReport: _hasReport, eventCount: _eventCount, ...fields } = snapshot;
          void _hasReport;
          void _eventCount;
          return { ...s, session: { ...s.session, ...fields } };
        });
      });
      source.addEventListener("end", () => {
        source.close();
        setState((s) => ({ ...s, connection: "closed" }));
        void refetch();
      });
    })();

    return () => {
      cancelled = true;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [id, refetch]);

  return { ...state, refetch };
}

/** Ticks once a second while `active`, for elapsed-time displays. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
