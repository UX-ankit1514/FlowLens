import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
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
 * Local session storage. The active working set stays in memory for fast SSE
 * updates, while every mutation is atomically mirrored to a JSON file when a
 * persistence directory is configured.
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

const MAX_SESSIONS_IN_MEMORY = 50;
const SAFE_SESSION_ID = /^[a-zA-Z0-9-]+$/;
const EXECUTION_STATUSES = new Set(["CREATED", "STARTING", "RUNNING", "ANALYSING", "COMPLETED", "FAILED", "CANCELLED"]);

export const LOCAL_HISTORY_DIRECTORY = path.join(process.cwd(), ".flowlens-data", "sessions");

function isStoredSession(value: unknown): value is TestSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<TestSession>;
  return Boolean(
    typeof session.id === "string" &&
      SAFE_SESSION_ID.test(session.id) &&
      session.definition &&
      typeof session.definition === "object" &&
      session.definition.id === session.id &&
      typeof session.definition.websiteUrl === "string" &&
      typeof session.definition.goal === "string" &&
      session.definition.persona &&
      typeof session.definition.persona.description === "string" &&
      Array.isArray(session.definition.successCriteria) &&
      typeof session.executionStatus === "string" &&
      EXECUTION_STATUSES.has(session.executionStatus) &&
      typeof session.createdAt === "string" &&
      Array.isArray(session.events) &&
      Array.isArray(session.steps) &&
      Array.isArray(session.notes),
  );
}

export class SessionStore {
  private sessions = new Map<string, TestSession>();
  private emitter = new EventEmitter();
  private persistenceDir?: string;

  constructor(options: { persistenceDir?: string } = {}) {
    this.emitter.setMaxListeners(200);
    if (options.persistenceDir) this.enablePersistence(options.persistenceDir);
  }

  /** Enables Mac-local JSON persistence and imports any sessions already saved there. */
  enablePersistence(directory: string): void {
    this.persistenceDir = path.resolve(directory);
    for (const saved of this.readPersistedSessions()) {
      if (!this.sessions.has(saved.id)) this.sessions.set(saved.id, saved);
    }
    // When enabled during a dev hot reload, preserve the sessions that were
    // already in RAM before this version of the store was loaded.
    for (const session of this.sessions.values()) this.persist(session);
    this.evictOldest();
  }

  /** Imports a session from an older hot-reloaded store instance. */
  restore(session: TestSession): void {
    if (!isStoredSession(session)) return;
    this.sessions.set(session.id, session);
    this.persist(session);
    this.evictOldest();
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
    this.persist(session);
    this.evictOldest();
    return session;
  }

  get(id: string): TestSession | undefined {
    const cached = this.sessions.get(id);
    if (cached) return cached;
    const saved = this.readPersistedSession(id);
    if (saved) {
      this.sessions.set(id, saved);
      this.evictOldest();
    }
    return saved;
  }

  /** Returns newest-first history, including sessions not in the memory cache. */
  listRecent(limit = 50): TestSession[] {
    const combined = new Map<string, TestSession>();
    for (const saved of this.readPersistedSessions()) combined.set(saved.id, saved);
    for (const session of this.sessions.values()) combined.set(session.id, session);
    return [...combined.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(0, limit));
  }

  /** Applies a mutation and notifies subscribers with a fresh snapshot. */
  update(id: string, mutate: (session: TestSession) => void): TestSession {
    const session = this.require(id);
    mutate(session);
    this.persist(session);
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
    this.persist(session);
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
    const session = this.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }

  private evictOldest() {
    while (this.sessions.size > MAX_SESSIONS_IN_MEMORY) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  private fileFor(id: string): string | undefined {
    if (!this.persistenceDir || !SAFE_SESSION_ID.test(id)) return undefined;
    return path.join(this.persistenceDir, `${id}.json`);
  }

  private persist(session: TestSession): void {
    const target = this.fileFor(session.id);
    if (!target || !this.persistenceDir) return;
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(this.persistenceDir, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, target);
    } catch (error) {
      try {
        if (existsSync(temporary)) unlinkSync(temporary);
      } catch {
        /* best-effort cleanup */
      }
      console.error(`[flowlens] could not save local history for session ${session.id}`, error);
    }
  }

  private readPersistedSession(id: string): TestSession | undefined {
    const file = this.fileFor(id);
    if (!file || !existsSync(file)) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!isStoredSession(parsed) || parsed.id !== id) throw new Error("Invalid stored session shape");
      return parsed;
    } catch (error) {
      console.warn(`[flowlens] ignored unreadable local history file ${path.basename(file)}`, error);
      return undefined;
    }
  }

  private readPersistedSessions(): TestSession[] {
    if (!this.persistenceDir || !existsSync(this.persistenceDir)) return [];
    const sessions: TestSession[] = [];
    for (const name of readdirSync(this.persistenceDir).filter((entry) => entry.endsWith(".json"))) {
      const id = name.slice(0, -5);
      const session = this.readPersistedSession(id);
      if (session) sessions.push(session);
    }
    return sessions;
  }
}

// Survive hot reloads and share one store across route modules in this process.
const globalStore = globalThis as unknown as { __flowlensSessionStore?: SessionStore };
const previousStore = globalStore.__flowlensSessionStore;
const previousSessions =
  previousStore && typeof previousStore.enablePersistence !== "function"
    ? [...(((previousStore as unknown as { sessions?: Map<string, TestSession> }).sessions ?? new Map()).values())]
    : [];

const sharedStore =
  previousStore && typeof previousStore.enablePersistence === "function" ? previousStore : new SessionStore();
globalStore.__flowlensSessionStore = sharedStore;

if (process.env.NODE_ENV !== "test") sharedStore.enablePersistence(LOCAL_HISTORY_DIRECTORY);
for (const session of previousSessions) sharedStore.restore(session);

export const sessionStore: SessionStore = sharedStore;
