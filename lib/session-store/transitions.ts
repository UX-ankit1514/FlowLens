import type { ExecutionStatus } from "@/types";

/**
 * Execution lifecycle:
 *   CREATED → STARTING → RUNNING → ANALYSING → COMPLETED
 * with FAILED / CANCELLED as alternative terminal states.
 *
 * Execution status describes whether the *run* worked. Whether the *task* was
 * achieved is a separate TaskOutcome — COMPLETED + BLOCKED is a valid pair.
 */
const ALLOWED: Record<ExecutionStatus, ExecutionStatus[]> = {
  CREATED: ["STARTING", "FAILED", "CANCELLED"],
  // STARTING → ANALYSING covers very short runs that complete before any progress event.
  STARTING: ["RUNNING", "ANALYSING", "FAILED", "CANCELLED"],
  RUNNING: ["ANALYSING", "FAILED", "CANCELLED"],
  ANALYSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class InvalidTransitionError extends Error {
  constructor(from: ExecutionStatus, to: ExecutionStatus) {
    super(`Invalid session transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}
