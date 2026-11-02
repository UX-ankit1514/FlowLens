import type { Checkpoint, JourneyStep, StepFlagKind, UXFinding } from "@/types";
import type { FeedbackColor } from "./labels";

/**
 * Presentation helpers for the UX report. They only re-arrange and re-word
 * data the report already holds; nothing here changes an outcome, a finding
 * or a piece of evidence.
 */

/* ------------------------------------------------------------------------ */
/* Severity                                                                  */
/* ------------------------------------------------------------------------ */

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export const SEVERITY_ORDER: Severity[] = ["HIGH", "MEDIUM", "LOW"];

export const SEVERITY_VIEW: Record<Severity, { label: string; short: string; color: FeedbackColor; rule: string }> = {
  HIGH: {
    label: "High severity",
    short: "High",
    color: "negative",
    rule: "It kept a success criterion from being met.",
  },
  MEDIUM: {
    label: "Medium severity",
    short: "Medium",
    color: "notice",
    rule: "Something broke or slowed the task, but no success criterion was lost to it.",
  },
  LOW: {
    label: "Low severity",
    short: "Low",
    color: "neutral",
    rule: "Worth a look; it didn't visibly stop or break the task.",
  },
};

/**
 * Severity, set by a fixed and visible rule from what the agent ran into
 * (impact only; one session can't show how often real people would hit it).
 */
export function findingSeverity(finding: UXFinding, checkpoints: Checkpoint[]): Severity {
  const status = new Map(checkpoints.map((c) => [c.id, c.status]));
  const costCriterion = finding.affectsCriteria.some((id) => {
    const s = status.get(id);
    return s !== undefined && s !== "PASSED";
  });
  if (costCriterion) return "HIGH";
  if (finding.kind === "FUNCTIONAL_FAILURE" || finding.affectsCriteria.length > 0) return "MEDIUM";
  return "LOW";
}

/** Findings sorted by severity, keeping the report's own order within each level. */
export function bySeverity(findings: UXFinding[], checkpoints: Checkpoint[]): Array<{ finding: UXFinding; severity: Severity }> {
  return findings
    .map((finding, index) => ({ finding, index, severity: findingSeverity(finding, checkpoints) }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.index - b.index)
    .map(({ finding, severity }) => ({ finding, severity }));
}

/* ------------------------------------------------------------------------ */
/* Evidence references in plain language                                     */
/* ------------------------------------------------------------------------ */

const REF_NAME: Record<string, string> = {
  S: "Step",
  E: "Event",
  C: "Criterion",
  A: "Action",
  O: "Obstacle",
  N: "Note",
  F: "Issue",
  T: "Setup issue",
  P: "Pattern",
};

/** "S16" → "Step 16", "C2" → "Criterion 2". Unknown shapes are returned unchanged. */
export function refName(ref: string): string {
  const match = /^([A-Z])(\d+)$/.exec(ref);
  if (!match || !REF_NAME[match[1]]) return ref;
  return `${REF_NAME[match[1]]} ${match[2]}`;
}

export type RefToken = { text: string } | { ref: string; label: string };

const REF_PATTERN = /\b([SECAONFTP])(\d+)(?:\s*[–-]\s*\1(\d+))?\b/g;

/**
 * Splits report text into plain text and evidence references. Only refs the
 * report actually holds are treated as references, so "A4 paper" or "S3
 * model" in agent text stay as they are.
 */
export function tokenizeRefs(text: string, isKnown: (ref: string) => boolean): RefToken[] {
  const tokens: RefToken[] = [];
  let last = 0;
  for (const match of text.matchAll(REF_PATTERN)) {
    const [whole, letter, from, to] = match;
    const ref = `${letter}${from}`;
    if (!isKnown(ref)) continue;
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: text.slice(last, index) });
    const name = REF_NAME[letter];
    const label = to ? `${name === "Criterion" ? "Criteria" : `${name}s`} ${from}–${to}` : `${name} ${from}`;
    tokens.push({ ref, label });
    last = index + whole.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}

/** Plain-text version of tokenizeRefs, for copied summaries. */
export function humanizeRefs(text: string, isKnown: (ref: string) => boolean): string {
  return tokenizeRefs(text, isKnown)
    .map((t) => ("ref" in t ? t.label.toLowerCase() : t.text))
    .join("");
}

/* ------------------------------------------------------------------------ */
/* Journey                                                                   */
/* ------------------------------------------------------------------------ */

/** Flags that show the agent struggling on the site (not the test setup). */
const FRICTION: StepFlagKind[] = ["REPEAT", "RETRY", "BACKTRACK", "ERROR"];

export type StepTone = "smooth" | "friction" | "error" | "setup" | "note" | "end";

export function stepTone(step: JourneyStep): StepTone {
  if (step.terminal) return step.terminal === "FAILED" ? "error" : "end";
  const kinds = new Set(step.flags.map((f) => f.kind));
  if (kinds.has("ERROR")) return "error";
  if (kinds.has("TECHNICAL")) return "setup";
  if (FRICTION.some((k) => kinds.has(k))) return "friction";
  if (kinds.has("INTERRUPTION") || kinds.has("DIRECT_URL")) return "note";
  return "smooth";
}

export function isFrictionStep(step: JourneyStep): boolean {
  const tone = stepTone(step);
  return tone === "friction" || tone === "error";
}

export const STEP_TONE_LABEL: Record<StepTone, string> = {
  smooth: "No problems recorded",
  friction: "Repeated, retried or went back",
  error: "Error",
  setup: "Test setup problem",
  note: "Pop-up or typed address",
  end: "End of run",
};

/** "2:22" → "2 min 22 s" for headers. */
export function readableDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** Host and path only, shortened: for headers, where query strings are noise. */
export function shortUrl(url: string, max = 60): string {
  let text = url;
  try {
    const u = new URL(url);
    text = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    // keep as given
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
