import type {
  CheckpointVerification,
  CheckpointStatus,
  ExecutionStatus,
  FindingKind,
  HumanValidationStatus,
  JourneyPatternKind,
  LegacyTaskOutcome,
  StepFlagKind,
  TaskOutcome,
  UXFinding,
} from "@/types";

export type FeedbackColor = "positive" | "negative" | "notice" | "information" | "neutral" | "primary";

type StatusInput = {
  executionStatus: ExecutionStatus;
  providerRunId?: string;
  cancelRequested?: boolean;
};

/** UI status (Preparing / Connecting / Running / …) derived from execution state. */
export function sessionStatusView({ executionStatus, providerRunId, cancelRequested }: StatusInput): {
  label: string;
  color: FeedbackColor;
  busy: boolean;
} {
  switch (executionStatus) {
    case "CREATED":
      return { label: "Preparing session", color: "neutral", busy: true };
    case "STARTING":
      return cancelRequested
        ? { label: "Stopping…", color: "notice", busy: true }
        : providerRunId
          ? { label: "Connecting", color: "information", busy: true }
          : { label: "Preparing session", color: "neutral", busy: true };
    case "RUNNING":
      return cancelRequested
        ? { label: "Stopping…", color: "notice", busy: true }
        : { label: "Running", color: "primary", busy: true };
    case "ANALYSING":
      return { label: "Analysing results", color: "information", busy: true };
    case "COMPLETED":
      return { label: "Completed", color: "positive", busy: false };
    case "FAILED":
      return { label: "Failed", color: "negative", busy: false };
    case "CANCELLED":
      return { label: "Cancelled", color: "neutral", busy: false };
  }
}

export const TASK_OUTCOME_VIEW: Record<TaskOutcome | LegacyTaskOutcome, { label: string; color: FeedbackColor; description: string }> = {
  VERIFIED_COMPLETE: { label: "Verified complete", color: "positive", description: "Every criterion was met and confirmed in a screenshot." },
  REPORTED_COMPLETE: { label: "Reported complete", color: "information", description: "The agent reported success; FlowLens couldn't confirm it independently." },
  PARTIAL: { label: "Partially complete", color: "notice", description: "Some success criteria were met." },
  NOT_COMPLETED: { label: "Not completed", color: "negative", description: "No success criteria were met." },
  BLOCKED: { label: "Blocked", color: "neutral", description: "The test environment stopped the agent." },
  NOT_VERIFIED: { label: "Not verified", color: "neutral", description: "There isn't enough evidence to judge the task." },
  // Saved sessions from before report version 2.
  COMPLETED: { label: "Reported complete", color: "information", description: "The agent reported success." },
  INCONCLUSIVE: { label: "Not verified", color: "neutral", description: "There isn't enough evidence to judge the task." },
};

export const CHECKPOINT_VIEW: Record<CheckpointStatus, { label: string; color: FeedbackColor }> = {
  PASSED: { label: "Passed", color: "positive" },
  FAILED: { label: "Failed", color: "negative" },
  BLOCKED: { label: "Blocked", color: "notice" },
  NOT_VERIFIED: { label: "Not verified", color: "neutral" },
};

export const VERIFICATION_VIEW: Record<CheckpointVerification, { label: string; color: FeedbackColor }> = {
  CONFIRMED: { label: "Confirmed in screenshot", color: "positive" },
  CONSISTENT: { label: "Consistent with trace", color: "information" },
  AGENT_REPORTED: { label: "Agent-reported only", color: "neutral" },
  LIMITED: { label: "Limited by technical blocker", color: "notice" },
  CONTRADICTED: { label: "Conflicting evidence", color: "negative" },
  NOT_APPLICABLE: { label: "", color: "neutral" },
};

export const CHECKPOINT_VERIFICATION_VIEW = VERIFICATION_VIEW;

export const FINDING_KIND_VIEW: Record<FindingKind, { label: string; plural: string; color: FeedbackColor; description: string }> = {
  FUNCTIONAL_FAILURE: {
    label: "Functional failure",
    plural: "Functional failures",
    color: "negative",
    description: "Something observably failed or did not work.",
  },
  USABILITY_HYPOTHESIS: {
    label: "Usability hypothesis",
    plural: "Usability hypotheses",
    color: "notice",
    description: "A design issue to investigate, supported by this recorded journey.",
  },
};

export const FINDING_KIND_ORDER: FindingKind[] = ["FUNCTIONAL_FAILURE", "USABILITY_HYPOTHESIS"];

export function findingOriginLabel(origin: UXFinding["origin"]): string {
  return origin === "AI" ? "AI interpretation · evidence checked" : "Rule-based · evidence checked";
}

export const PATTERN_KIND_LABEL: Record<JourneyPatternKind, string> = {
  REPEATED_ACTION: "Repeated action",
  BACKTRACKING: "Backtracking",
  ROUTE_CHANGE: "Route change",
  DEAD_END: "Dead end",
  INFORMATION_NOT_FOUND: "Information not found",
  CONFUSING_NAVIGATION: "Confusing navigation",
  UNNECESSARY_STEPS: "Extra steps",
  INCOMPLETE_TASK: "Incomplete task",
};

export const FLAG_VIEW: Record<StepFlagKind, { label: string; color: FeedbackColor }> = {
  RETRY: { label: "Retry", color: "notice" },
  REPEAT: { label: "Repeat", color: "notice" },
  BACKTRACK: { label: "Went back", color: "neutral" },
  ERROR: { label: "Error", color: "negative" },
  TECHNICAL: { label: "Technical", color: "information" },
  INTERRUPTION: { label: "Pop-up", color: "neutral" },
  DIRECT_URL: { label: "By URL", color: "neutral" },
  WAIT: { label: "Wait", color: "neutral" },
};

export const VALIDATION_VIEW: Record<HumanValidationStatus, { label: string; color: FeedbackColor }> = {
  NOT_TESTED: { label: "Not tested", color: "neutral" },
  OBSERVED: { label: "Observed with participants", color: "positive" },
  NOT_OBSERVED: { label: "Not observed with participants", color: "notice" },
};

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname.replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return url;
  }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Returns the URL only if it is plain http(s). Page URLs in reports come from
 * the agent's output, which a hostile page could try to influence, so they are
 * never rendered as links unless they are ordinary web addresses.
 */
export function safeHttpUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
