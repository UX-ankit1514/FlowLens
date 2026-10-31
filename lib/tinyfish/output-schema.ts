import { z } from "zod";

/**
 * The structured result requested from the TinyFish browser agent.
 *
 * Follows TinyFish's output_schema rules (docs.tinyfish.ai/key-concepts/structured-output):
 * top-level object; only type/properties/required/items/enum/nullable/
 * propertyOrdering/min/max keywords; `nullable: true` instead of type arrays;
 * no additionalProperties/const/oneOf/examples. A unit test enforces this.
 *
 * It asks only for things a browser agent can observe — no screenshots,
 * coordinates, emotions or opinions.
 */

export const AGENT_TASK_OUTCOMES = ["completed", "partially_completed", "blocked", "not_completed"] as const;
export const AGENT_CHECKPOINT_STATUSES = ["passed", "failed", "blocked", "not_verified"] as const;
export const AGENT_ACTION_RESULTS = ["succeeded", "failed", "no_visible_effect"] as const;
export const AGENT_OBSTACLE_KINDS = [
  "error_or_broken_page",
  "action_failed",
  "information_not_found",
  "unclear_navigation",
  "unexpected_step",
  "repeated_attempts",
  "login_required",
  "captcha_or_bot_protection",
  "site_unreachable",
  "irreversible_step_required",
  "other",
] as const;

export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    task_outcome: { type: "string", enum: [...AGENT_TASK_OUTCOMES] },
    outcome_summary: { type: "string" },
    final_answer: { type: "string", nullable: true },
    checkpoints: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          status: { type: "string", enum: [...AGENT_CHECKPOINT_STATUSES] },
          observation: { type: "string" },
          page_url: { type: "string", nullable: true },
        },
        required: ["criterion", "status", "observation"],
      },
    },
    actions: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          page_url: { type: "string", nullable: true },
          result: { type: "string", enum: [...AGENT_ACTION_RESULTS] },
        },
        required: ["description", "result"],
      },
    },
    obstacles: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...AGENT_OBSTACLE_KINDS] },
          description: { type: "string" },
          page_url: { type: "string", nullable: true },
          blocked_progress: { type: "boolean" },
        },
        required: ["kind", "description", "blocked_progress"],
      },
    },
    urls_visited: { type: "array", maxItems: 50, items: { type: "string" } },
  },
  required: ["task_outcome", "outcome_summary", "checkpoints", "actions", "obstacles", "urls_visited"],
  propertyOrdering: [
    "task_outcome",
    "outcome_summary",
    "final_answer",
    "checkpoints",
    "actions",
    "obstacles",
    "urls_visited",
  ],
} as const;

/* ------------------------------------------------------------------------ */
/* Lenient parsing of what the agent actually returned.                      */
/* Unknown enum values degrade to safe defaults instead of discarding data.  */
/* ------------------------------------------------------------------------ */

// .nullish() keeps the key optional in Zod 4 (a union with z.undefined() does not).
const optionalString = z
  .string()
  .nullish()
  .catch(undefined)
  .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined));

const enumOr = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.unknown().transform((v): T[number] => {
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    return (values as readonly string[]).includes(s) ? (s as T[number]) : fallback;
  });

const checkpointSchema = z.object({
  criterion: z.string().catch(""),
  status: enumOr(AGENT_CHECKPOINT_STATUSES, "not_verified"),
  observation: z.string().catch(""),
  page_url: optionalString,
});

const actionSchema = z.object({
  description: z.string().catch(""),
  page_url: optionalString,
  result: enumOr(AGENT_ACTION_RESULTS, "succeeded"),
});

const obstacleSchema = z.object({
  kind: enumOr(AGENT_OBSTACLE_KINDS, "other"),
  description: z.string().catch(""),
  page_url: optionalString,
  blocked_progress: z.boolean().catch(false),
});

const listOf = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((raw) => {
        const parsed = item.safeParse(raw);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );

export const agentObservationsSchema = z.object({
  task_outcome: enumOr(AGENT_TASK_OUTCOMES, "not_completed"),
  outcome_summary: z.string().catch(""),
  final_answer: optionalString,
  checkpoints: listOf(checkpointSchema),
  actions: listOf(actionSchema),
  obstacles: listOf(obstacleSchema),
  urls_visited: z
    .array(z.unknown())
    .default([])
    .transform((items) => items.filter((u): u is string => typeof u === "string" && u.trim().length > 0)),
});

export type AgentObservations = z.output<typeof agentObservationsSchema>;
export type AgentObstacle = AgentObservations["obstacles"][number];

export type ParsedObservations =
  | { ok: true; data: AgentObservations }
  | { ok: false; reason: string };

/** Validates the provider result. Never throws; never invents missing data. */
export function parseAgentObservations(result: unknown): ParsedObservations {
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "TinyFish returned no structured result." };
  }
  const record = result as Record<string, unknown>;
  // TinyFish signals goal-level failure as { status: "failure", reason }.
  if (!("task_outcome" in record) && !("checkpoints" in record)) {
    const reason = typeof record.reason === "string" ? record.reason : undefined;
    return {
      ok: false,
      reason: reason
        ? `TinyFish returned an unstructured result: ${reason}`
        : "TinyFish's result did not match the requested structure.",
    };
  }
  const parsed = agentObservationsSchema.safeParse(record);
  if (!parsed.success) {
    return { ok: false, reason: "TinyFish's result did not match the requested structure." };
  }
  return { ok: true, data: parsed.data };
}
