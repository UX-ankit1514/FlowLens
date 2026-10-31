import { z } from "zod";
import { normalizeWebsiteUrl } from "@/lib/security/url";

/**
 * The request contract for POST /api/sessions. Shared by the form (for inline
 * validation) and the API route (authoritative validation).
 *
 * Persona text is stored exactly as typed — only surrounding whitespace is
 * trimmed. FlowLens never rewrites, completes or expands it.
 */

export const LIMITS = {
  persona: 4000,
  goal: 1000,
  criterion: 500,
  criteriaCount: 10,
  sessionName: 120,
  featureField: 1500,
} as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const testInputSchema = z.object({
  websiteUrl: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const check = normalizeWebsiteUrl(value);
      if (!check.ok) ctx.addIssue({ code: "custom", message: check.reason });
    }),
  persona: z
    .string()
    .trim()
    .min(1, "Describe who you're testing for. Paste your existing persona here.")
    .max(LIMITS.persona, `Keep the persona under ${LIMITS.persona} characters.`),
  goal: z
    .string()
    .trim()
    .min(1, "Describe what this user wants to accomplish.")
    .max(LIMITS.goal, `Keep the goal under ${LIMITS.goal} characters.`),
  successCriteria: z
    .array(z.string().trim().max(LIMITS.criterion, `Keep each criterion under ${LIMITS.criterion} characters.`))
    .transform((items) => items.filter((item) => item.length > 0))
    .pipe(
      z
        .array(z.string())
        .min(1, "Add at least one success criterion.")
        .max(LIMITS.criteriaCount, `Use at most ${LIMITS.criteriaCount} success criteria.`),
    ),
  sessionName: optionalText(LIMITS.sessionName),
  featureContext: z
    .object({
      name: optionalText(LIMITS.sessionName),
      description: optionalText(LIMITS.featureField),
      intendedBenefit: optionalText(LIMITS.featureField),
      expectedOutcome: optionalText(LIMITS.featureField),
    })
    .optional(),
});

export type TestInput = z.input<typeof testInputSchema>;
export type ValidTestInput = z.output<typeof testInputSchema>;

/** Splits the success-criteria text box into one criterion per line. */
export function splitCriteria(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/** Suggests a session name from the goal (used only as a placeholder/default). */
export function suggestSessionName(goal: string): string {
  const firstSentence = goal.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  const clean = firstSentence.replace(/[.!?]+$/, "");
  if (clean.length <= 80) return clean;
  return `${clean.slice(0, 77).replace(/\s+\S*$/, "")}…`;
}

export type FieldErrors = Partial<Record<"websiteUrl" | "persona" | "goal" | "successCriteria", string>>;

export function collectFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      (field === "websiteUrl" || field === "persona" || field === "goal" || field === "successCriteria") &&
      !errors[field]
    ) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
