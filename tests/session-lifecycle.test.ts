import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "@/lib/session-store/store";
import { canTransition, InvalidTransitionError, isTerminal } from "@/lib/session-store/transitions";
import { linkStepsToEvents } from "@/lib/tinyfish/runner";
import type { SessionEvent } from "@/types";

const definition = {
  websiteUrl: "https://example.com/",
  persona: { id: "p", description: "Persona" },
  goal: "Goal",
  successCriteria: ["One"],
};

describe("session transitions", () => {
  it("follows CREATED → STARTING → RUNNING → ANALYSING → COMPLETED", () => {
    const store = new SessionStore();
    const s = store.create(definition);
    for (const status of ["STARTING", "RUNNING", "ANALYSING", "COMPLETED"] as const) store.transition(s.id, status);
    expect(store.get(s.id)?.executionStatus).toBe("COMPLETED");
  });

  it("allows FAILED or CANCELLED from active states, and terminal states are final", () => {
    expect(canTransition("RUNNING", "CANCELLED")).toBe(true);
    expect(canTransition("STARTING", "FAILED")).toBe(true);
    expect(canTransition("ANALYSING", "CANCELLED")).toBe(false);
    expect(isTerminal("CANCELLED")).toBe(true);
    const store = new SessionStore();
    const s = store.create(definition);
    store.transition(s.id, "STARTING");
    store.transition(s.id, "CANCELLED");
    expect(() => store.transition(s.id, "COMPLETED")).toThrow(InvalidTransitionError);
  });

  it("keeps task outcome separate from execution status", () => {
    const store = new SessionStore();
    const s = store.create(definition);
    store.transition(s.id, "STARTING");
    store.transition(s.id, "RUNNING");
    store.transition(s.id, "ANALYSING");
    store.transition(s.id, "COMPLETED", (x) => {
      x.taskOutcome = "BLOCKED";
    });
    expect(store.get(s.id)).toMatchObject({ executionStatus: "COMPLETED", taskOutcome: "BLOCKED" });
  });

  it("numbers events in order and notifies subscribers", () => {
    const store = new SessionStore();
    const s = store.create(definition);
    const seen: number[] = [];
    const unsubscribe = store.subscribe(s.id, (c) => c.kind === "event" && seen.push(c.event.sequence));
    store.appendEvent(s.id, { type: "AGENT_PROGRESS", description: "a", source: "provider" });
    store.appendEvent(s.id, { type: "AGENT_PROGRESS", description: "b", source: "provider" });
    unsubscribe();
    store.appendEvent(s.id, { type: "AGENT_PROGRESS", description: "c", source: "provider" });
    expect(seen).toEqual([1, 2]);
    expect(store.get(s.id)?.events.map((e) => e.id)).toEqual(["E1", "E2", "E3"]);
  });

  it("labels designer notes as separate references", () => {
    const store = new SessionStore();
    const s = store.create(definition);
    expect(store.addNote(s.id, "The cookie banner covered the search box").ref).toBe("N1");
  });
});

describe("local session history", () => {
  it("restores sessions and notes from JSON after a server restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "flowlens-history-"));
    try {
      const first = new SessionStore({ persistenceDir: directory });
      const session = first.create(definition);
      first.transition(session.id, "STARTING");
      first.transition(session.id, "RUNNING");
      first.appendEvent(session.id, { type: "AGENT_PROGRESS", description: "Opened search", source: "provider" });
      first.addNote(session.id, "Keep this note after restart");

      const afterRestart = new SessionStore({ persistenceDir: directory });
      expect(afterRestart.get(session.id)).toMatchObject({
        id: session.id,
        executionStatus: "RUNNING",
        notes: [{ ref: "N1", text: "Keep this note after restart" }],
      });
      expect(afterRestart.listRecent().map((item) => item.id)).toContain(session.id);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("linking recorded steps to timeline events", () => {
  it("pairs steps with the progress events that announced them, in order", () => {
    const ev = (n: number, description: string): SessionEvent => ({
      id: `E${n}`,
      sequence: n,
      timestamp: "2026-10-31T00:00:00Z",
      type: "AGENT_PROGRESS",
      description,
      source: "provider",
      tone: "neutral",
    });
    const session = { events: [ev(1, "Open home"), ev(2, "Search"), ev(3, "Search"), ev(4, "Unmatched")] };
    linkStepsToEvents(session, [
      { ref: "S1", stepId: "a", action: "Open home", hasScreenshot: true },
      { ref: "S2", stepId: "b", action: "Search", hasScreenshot: true },
      { ref: "S3", stepId: "c", action: "Search", hasScreenshot: true },
      { ref: "S4", stepId: "d", action: "Task completed", hasScreenshot: false },
    ]);
    expect(session.events.map((e) => e.evidenceRef)).toEqual(["S1", "S2", "S3", undefined]);
  });
});
