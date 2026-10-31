import type {
  CheckpointStatus,
  Confidence,
  ExecutionStatus,
  FindingCategory,
  Severity,
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

export const TASK_OUTCOME_VIEW: Record<TaskOutcome, { label: string; color: FeedbackColor; description: string }> = {
  COMPLETED: { label: "Completed", color: "positive", description: "The agent met every success criterion." },
  PARTIAL: { label: "Partially completed", color: "notice", description: "Some success criteria were met." },
  BLOCKED: { label: "Blocked", color: "information", description: "Something outside the design stopped the test." },
  NOT_COMPLETED: { label: "Not completed", color: "negative", description: "No success criteria were met." },
  INCONCLUSIVE: { label: "Inconclusive", color: "neutral", description: "There isn't enough evidence to judge the task." },
};

export const CHECKPOINT_VIEW: Record<CheckpointStatus, { label: string; color: FeedbackColor }> = {
  PASSED: { label: "Passed", color: "positive" },
  FAILED: { label: "Failed", color: "negative" },
  BLOCKED: { label: "Blocked", color: "notice" },
  NOT_VERIFIED: { label: "Not verified", color: "neutral" },
};

export const SEVERITY_VIEW: Record<Severity, { label: string; color: FeedbackColor }> = {
  HIGH: { label: "High severity", color: "negative" },
  MEDIUM: { label: "Medium severity", color: "notice" },
  LOW: { label: "Low severity", color: "neutral" },
};

export const CATEGORY_VIEW: Record<FindingCategory, { label: string; plural: string; description: string }> = {
  BROKEN_JOURNEY: {
    label: "Broken journey",
    plural: "Broken journeys",
    description: "Actions that failed, dead ends, or errors.",
  },
  MISSING_INFORMATION: {
    label: "Missing information",
    plural: "Missing or inaccessible information",
    description: "Information the agent needed but did not find during the test.",
  },
  CONFUSING_FLOW: {
    label: "Confusing flow",
    plural: "Potentially confusing flows",
    description: "Ambiguous options or unclear next steps.",
  },
  POTENTIAL_FRICTION: {
    label: "Potential friction",
    plural: "Potential friction",
    description: "Extra steps, unexpected requirements or repeated attempts.",
  },
};

export const CATEGORY_ORDER: FindingCategory[] = [
  "BROKEN_JOURNEY",
  "MISSING_INFORMATION",
  "CONFUSING_FLOW",
  "POTENTIAL_FRICTION",
];

export function confidenceLabel(confidence: Confidence, origin: UXFinding["origin"]): string {
  if (confidence === "UNCERTAIN") return "Uncertain";
  if (confidence === "INFERRED") return "Inferred from pattern";
  return origin === "AI_INTERPRETATION" ? "Supported by recorded evidence" : "Reported by the agent";
}

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
