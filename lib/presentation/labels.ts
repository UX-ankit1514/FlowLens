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
  VERIFIED_COMPLETE: { label: "Task completed", color: "positive", description: "Every success criterion was met and seen in a screenshot." },
  REPORTED_COMPLETE: { label: "Completed, not confirmed", color: "information", description: "The agent says it met every criterion; the screenshots don't prove it yet." },
  PARTIAL: { label: "Partly completed", color: "notice", description: "Some success criteria were met." },
  NOT_COMPLETED: { label: "Not completed", color: "negative", description: "None of the success criteria were met." },
  BLOCKED: { label: "Blocked by the test setup", color: "neutral", description: "Something in the test environment stopped the agent. This isn't a design verdict." },
  NOT_VERIFIED: { label: "Can't tell", color: "neutral", description: "There isn't enough evidence to judge the task." },
  // Saved sessions from before report version 2.
  COMPLETED: { label: "Completed, not confirmed", color: "information", description: "The agent reported success." },
  INCONCLUSIVE: { label: "Can't tell", color: "neutral", description: "There isn't enough evidence to judge the task." },
};

export const CHECKPOINT_VIEW: Record<CheckpointStatus, { label: string; color: FeedbackColor }> = {
  PASSED: { label: "Met", color: "positive" },
  FAILED: { label: "Not met", color: "negative" },
  BLOCKED: { label: "Blocked", color: "notice" },
  NOT_VERIFIED: { label: "Not checked", color: "neutral" },
};

/** How much a "met" criterion can be trusted, in plain language. */
export const VERIFICATION_VIEW: Record<CheckpointVerification, { label: string; color: FeedbackColor }> = {
  CONFIRMED: { label: "Seen in a screenshot", color: "positive" },
  CONSISTENT: { label: "Supported by the steps", color: "information" },
  AGENT_REPORTED: { label: "Agent's word only", color: "neutral" },
  LIMITED: { label: "Test setup interfered", color: "notice" },
  CONTRADICTED: { label: "Evidence disagrees", color: "negative" },
  NOT_APPLICABLE: { label: "", color: "neutral" },
};

export const CHECKPOINT_VERIFICATION_VIEW = VERIFICATION_VIEW;

export const FINDING_KIND_VIEW: Record<FindingKind, { label: string; plural: string; color: FeedbackColor; description: string }> = {
  FUNCTIONAL_FAILURE: {
    label: "Something broke",
    plural: "Things that broke",
    color: "negative",
    description: "A page, control or action didn't work.",
  },
  USABILITY_HYPOTHESIS: {
    label: "Possible usability issue",
    plural: "Possible usability issues",
    color: "notice",
    description: "Likely friction in the design, to confirm with real people.",
  },
};

export const FINDING_KIND_ORDER: FindingKind[] = ["FUNCTIONAL_FAILURE", "USABILITY_HYPOTHESIS"];

export function findingOriginLabel(origin: UXFinding["origin"]): string {
  return origin === "AI" ? "Written by AI from the evidence" : "Found by FlowLens rules";
}

export const PATTERN_KIND_LABEL: Record<JourneyPatternKind, string> = {
  REPEATED_ACTION: "Repeated an action",
  BACKTRACKING: "Went back",
  ROUTE_CHANGE: "Changed route",
  DEAD_END: "Hit a dead end",
  INFORMATION_NOT_FOUND: "Couldn't find information",
  CONFUSING_NAVIGATION: "Unclear where to go",
  UNNECESSARY_STEPS: "Extra steps",
  INCOMPLETE_TASK: "Task not finished",
};

export const FLAG_VIEW: Record<StepFlagKind, { label: string; color: FeedbackColor }> = {
  RETRY: { label: "Tried again", color: "notice" },
  REPEAT: { label: "Repeated", color: "notice" },
  BACKTRACK: { label: "Went back", color: "notice" },
  ERROR: { label: "Error", color: "negative" },
  TECHNICAL: { label: "Test setup", color: "information" },
  INTERRUPTION: { label: "Pop-up", color: "neutral" },
  DIRECT_URL: { label: "Typed address", color: "neutral" },
  WAIT: { label: "Waited", color: "neutral" },
};

export const VALIDATION_VIEW: Record<HumanValidationStatus, { label: string; color: FeedbackColor }> = {
  NOT_TESTED: { label: "Not checked with people yet", color: "neutral" },
  OBSERVED: { label: "Seen with real users", color: "positive" },
  NOT_OBSERVED: { label: "Not seen with real users", color: "notice" },
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
