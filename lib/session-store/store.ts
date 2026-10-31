import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  DesignerNote,
  ExecutionStatus,
  SessionEvent,
  SessionEventType,
  TestDefinition,
  TestSession,
} from "@/types";
import { canTransition, InvalidTransitionError } from "./transitions";

/**
 * In-memory session storage for the local MVP.
 *
 * NOTE: Sessions live only in this server process. Restarting the dev server
 * clears them. The interface (create/get/update/appendEvent/subscribe) is the
 * seam for swapping in a persistent database later.
 */

export type StoreChange =
  | { kind: "event"; event: SessionEvent }
  | { kind: "snapshot" };

type NewEvent = {
  type: SessionEventType;
  description: string;
  source?: SessionEvent["source"];
  tone?: SessionEvent["tone"];
  pageUrl?: string;
  evidenceRef?: string;
  timestamp?: string;
};

const MAX_SESSIONS = 50;

export class SessionStore {
  private sessions = new Map<string, TestSession>();
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  create(definition: Omit<TestDefinition, "id">): TestSession {
    const id = randomUUID();
    const session: TestSession = {
      id,
      definition: { ...definition, id },
      executionStatus: "CREATED",
      createdAt: new Date().toISOString(),
      events: [],
      liveViewStatus: "PENDING",
      steps: [],
      notes: [],
      cancelRequested: false,
    };
    this.sessions.set(id, session);
    this.evictOldest();
    return session;
  }

  get(id: string): TestSession | undefined {
    return this.sessions.get(id);
  }

  /** Applies a mutation and notifies subscribers with a fresh snapshot. */
  update(id: string, mutate: (session: TestSession) => void): TestSession {
    const session = this.require(id);
    mutate(session);
    this.emit(id, { kind: "snapshot" });
    return session;
  }

  transition(id: string, to: ExecutionStatus, mutate?: (session: TestSession) => void): TestSession {
    const session = this.require(id);
    if (session.executionStatus === to) {
      if (mutate) this.update(id, mutate);
      return session;
    }
    if (!canTransition(session.executionStatus, to)) {
      throw new InvalidTransitionError(session.executionStatus, to);
    }
    return this.update(id, (s) => {
      s.executionStatus = to;
      mutate?.(s);
    });
  }

  appendEvent(id: string, input: NewEvent): SessionEvent {
    const session = this.require(id);
    const sequence = session.events.length + 1;
    const event: SessionEvent = {
      id: `E${sequence}`,
      sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      description: input.description,
      source: input.source ?? "flowlens",
      tone: input.tone ?? "neutral",
      pageUrl: input.pageUrl,
      evidenceRef: input.evidenceRef,
    };
    session.events.push(event);
    this.emit(id, { kind: "event", event });
    return event;
  }

  addNote(id: string, text: string): DesignerNote {
    const session = this.require(id);
    const note: DesignerNote = {
      id: randomUUID(),
      ref: `N${session.notes.length + 1}`,
      createdAt: new Date().toISOString(),
      text,
    };
    this.update(id, (s) => {
      s.notes.push(note);
    });
    return note;
  }

  subscribe(id: string, listener: (change: StoreChange) => void): () => void {
    const channel = `session:${id}`;
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }

  private emit(id: string, change: StoreChange) {
    this.emitter.emit(`session:${id}`, change);
  }

  private require(id: string): TestSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }

  private evictOldest() {
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
}

// Survive hot reloads and share one store across route modules in this process.
const globalStore = globalThis as unknown as { __flowlensSessionStore?: SessionStore };
export const sessionStore: SessionStore = (globalStore.__flowlensSessionStore ??= new SessionStore());
