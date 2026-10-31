import type { AgentObservations } from "@/lib/tinyfish/output-schema";
import type { EvidenceItem, TestSession } from "@/types";

const OBSTACLE_LABELS: Record<string, string> = {
  error_or_broken_page: "Error or broken page",
  action_failed: "Action failed",
  information_not_found: "Information not found",
  unclear_navigation: "Unclear navigation",
  unexpected_step: "Unexpected step",
  repeated_attempts: "Repeated attempts",
  login_required: "Login required",
  captcha_or_bot_protection: "CAPTCHA or bot protection",
  site_unreachable: "Site unreachable",
  irreversible_step_required: "Stopped before an irreversible step",
  other: "Other obstacle",
};

export function obstacleLabel(kind: string): string {
  return OBSTACLE_LABELS[kind] ?? kind;
}

/**
 * Every piece of evidence a report may cite, with a stable reference:
 *   E# timeline events (received from TinyFish), S# recorded steps,
 *   C# agent checkpoint reports, A# agent actions, O# agent obstacles,
 *   N# designer notes (human-authored).
 */
export function buildEvidenceIndex(session: TestSession, observations?: AgentObservations): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  for (const event of session.events) {
    if (event.source !== "provider") continue;
    items.push({ ref: event.id, kind: "TIMELINE_EVENT", label: event.description, pageUrl: event.pageUrl });
  }
  for (const step of session.steps) {
    items.push({
      ref: step.ref,
      kind: "STEP_SCREENSHOT",
      label: step.action || "Recorded step",
      detail: step.hasScreenshot ? "Screenshot captured by TinyFish during this run" : "No screenshot for this step",
      stepId: step.stepId,
    });
  }
  observations?.checkpoints.forEach((cp, i) => {
    items.push({
      ref: `C${i + 1}`,
      kind: "AGENT_CHECKPOINT",
      label: `Agent report on criterion ${i + 1}: ${cp.status.replace("_", " ")}`,
      detail: cp.observation,
      pageUrl: cp.page_url,
    });
  });
  observations?.actions.forEach((action, i) => {
    items.push({
      ref: `A${i + 1}`,
      kind: "AGENT_ACTION",
      label: action.description,
      detail: `Result: ${action.result.replace(/_/g, " ")}`,
      pageUrl: action.page_url,
    });
  });
  observations?.obstacles.forEach((obstacle, i) => {
    items.push({
      ref: `O${i + 1}`,
      kind: "AGENT_OBSTACLE",
      label: `${obstacleLabel(obstacle.kind)}${obstacle.blocked_progress ? " (blocked progress)" : ""}`,
      detail: obstacle.description,
      pageUrl: obstacle.page_url,
    });
  });
  for (const note of session.notes) {
    items.push({ ref: note.ref, kind: "DESIGNER_NOTE", label: "Designer observation", detail: note.text });
  }
  return items;
}
