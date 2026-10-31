import type { AgentObservations } from "@/lib/tinyfish/output-schema";
import type { Checkpoint, JourneyPattern, JourneyStep, JourneyTrace } from "@/types";
import { classifyTechnical } from "./classify";
import { formatRefRanges, plural, shortTitle, stem, tokenSet, truncate } from "./text";

/**
 * Rule-based journey patterns. Each one is a description of the recorded
 * trace (repeats, going back, restarts, interruptions…) that cites the exact
 * steps it comes from. Interpretation is left to the findings and, when it's
 * configured, the reasoning model.
 */

type Draft = Omit<JourneyPattern, "id" | "origin">;

const ORDER: JourneyPattern["kind"][] = [
  "INCOMPLETE_TASK",
  "DEAD_END",
  "INFORMATION_NOT_FOUND",
  "CONFUSING_NAVIGATION",
  "REPEATED_ACTION",
  "BACKTRACKING",
  "ROUTE_CHANGE",
  "UNNECESSARY_STEPS",
];

/** Interface things a visitor works with; revisiting one several times is notable. */
const CONTROL_NOUNS = [
  "origin", "destination", "departure", "return date", "date", "calendar", "filter", "sort", "currency",
  "location", "language", "country", "search", "menu", "tab", "settings", "cart", "basket", "checkout",
  "login", "sign in", "account", "chat", "message", "price", "fare", "map", "size", "quantity",
  "address", "shipping", "delivery", "coupon", "promo code", "itinerary", "review",
];

const INTERACTIVE = new Set(["CLICK", "SELECT", "TYPE", "FOCUS", "SEARCH", "SUBMIT"]);

const CONTROL_STEMS = new Map(CONTROL_NOUNS.map((n) => [n.split(" ").map(stem).join(" "), n]));

export type PatternContext = {
  /** The designer's goal: its topic words aren't treated as revisited controls. */
  goal: string;
  websiteUrl: string;
};

export function detectPatterns(
  trace: Omit<JourneyTrace, "patterns">,
  observations: AgentObservations | undefined,
  checkpoints: Checkpoint[],
  context: PatternContext,
): JourneyPattern[] {
  const steps = trace.steps.filter((s) => !s.terminal && !s.flags.some((f) => f.kind === "TECHNICAL"));
  const drafts: Draft[] = [
    ...incompleteTask(checkpoints, observations, trace),
    ...deadEnds(steps, observations),
    ...fromObstacles(observations, trace.steps, context.websiteUrl),
    ...repeatedActions(steps),
    ...revisitedControls(steps, context.goal),
    ...backtracking(steps),
    ...routeChanges(steps),
    ...interruptions(steps),
  ];
  return drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => ORDER.indexOf(a.d.kind) - ORDER.indexOf(b.d.kind) || a.i - b.i)
    .map(({ d }, i) => ({ ...d, id: `P${i + 1}`, origin: "RULES" as const }));
}

function incompleteTask(
  checkpoints: Checkpoint[],
  observations: AgentObservations | undefined,
  trace: Omit<JourneyTrace, "patterns">,
): Draft[] {
  if (!observations && !trace.endedEarly) return [];
  const unmet = checkpoints.filter((c) => c.status !== "PASSED");
  if (unmet.length === 0) return [];
  const last = trace.steps[trace.steps.length - 1];
  if (!observations) {
    return [
      {
        kind: "INCOMPLETE_TASK",
        title: "Ended before the success criteria could be checked",
        description: `The run stopped${last ? ` at ${last.ref}` : ""}, so none of the ${checkpoints.length} success ${plural(checkpoints.length, "criterion was", "criteria were")} evaluated.`,
        stepRefs: last ? [last.ref] : [],
        evidenceRefs: [],
      },
    ];
  }
  return [
    {
      kind: "INCOMPLETE_TASK",
      title: `${unmet.length} of ${checkpoints.length} success ${plural(checkpoints.length, "criterion", "criteria")} not met`,
      description: unmet
        .map((c) => `${c.id} ${c.status === "FAILED" ? "failed" : c.status === "BLOCKED" ? "was blocked" : "wasn't verified"}: “${truncate(c.description, 80)}”`)
        .join("; "),
      stepRefs: trace.endedEarly && last ? [last.ref] : [],
      evidenceRefs: unmet.flatMap((c) => c.evidenceRefs),
    },
  ];
}

function deadEnds(steps: JourneyStep[], observations?: AgentObservations): Draft[] {
  const refs = new Set<string>();
  const notes: string[] = [];
  for (const step of steps) {
    if (step.flags.some((f) => f.kind === "ERROR")) {
      refs.add(step.ref);
      notes.push(`${step.ref} “${truncate(step.statedPurpose, 70)}”`);
    } else if (step.agentAction && step.agentAction.result !== "succeeded") {
      refs.add(step.ref);
      notes.push(`${step.ref} ${step.agentAction.result === "failed" ? "failed" : "had no visible effect"} (${step.agentAction.ref})`);
    }
  }
  // Failed actions the agent reported that couldn't be matched to a step.
  const evidence: string[] = [];
  observations?.actions.forEach((action, i) => {
    if (action.result === "succeeded" || classifyTechnical(action.description)) return;
    const ref = `A${i + 1}`;
    if (steps.some((s) => s.agentAction?.ref === ref)) return;
    evidence.push(ref);
    notes.push(`${ref} “${truncate(action.description, 70)}” ${action.result === "failed" ? "failed" : "had no visible effect"}`);
  });
  if (refs.size === 0 && evidence.length === 0) return [];
  const count = refs.size + evidence.length;
  return [
    {
      kind: "DEAD_END",
      title: `${count} ${plural(count, "step", "steps")} didn't have the intended effect`,
      description: notes.slice(0, 4).join("; ") + (notes.length > 4 ? `; and ${notes.length - 4} more` : ""),
      stepRefs: [...refs],
      evidenceRefs: evidence,
    },
  ];
}

function fromObstacles(observations: AgentObservations | undefined, allSteps: JourneyStep[], websiteUrl: string): Draft[] {
  if (!observations) return [];
  const drafts: Draft[] = [];
  observations.obstacles.forEach((obstacle, i) => {
    const text = `${obstacle.summary ?? ""} ${obstacle.description}`;
    if (classifyTechnical(text) || TECHNICAL_OBSTACLES.has(obstacle.kind)) return;
    const kind =
      obstacle.kind === "information_not_found"
        ? "INFORMATION_NOT_FOUND"
        : obstacle.kind === "unclear_navigation"
          ? "CONFUSING_NAVIGATION"
          : obstacle.kind === "unexpected_step"
            ? "UNNECESSARY_STEPS"
            : undefined;
    if (!kind) return;
    const title = obstacle.summary ? truncate(obstacle.summary, 80) : shortTitle(obstacle.description);
    drafts.push({
      kind,
      title,
      description: obstacle.description,
      stepRefs: stepsMentioning(allSteps, `${title} ${obstacle.expected ?? ""}`, websiteUrl),
      evidenceRefs: [`O${i + 1}`],
    });
  });
  return drafts;
}

export const TECHNICAL_OBSTACLES = new Set([
  "captcha_or_bot_protection",
  "site_unreachable",
  "login_required",
  "irreversible_step_required",
  "automation_environment",
]);

/**
 * Steps whose stated purpose shares a distinctive word with `text`. Words
 * that appear in most steps (the site's main topic) are ignored.
 */
export function stepsMentioning(steps: JourneyStep[], text: string, websiteUrl?: string, limit = 8): string[] {
  const candidates = steps.filter((s) => !s.terminal && !s.flags.some((f) => f.kind === "TECHNICAL"));
  if (candidates.length === 0) return [];
  const brand = hostWords(websiteUrl);
  const sets = candidates.map((s) => tokenSet(s.statedPurpose));
  const frequency = new Map<string, number>();
  for (const set of sets) for (const t of set) frequency.set(t, (frequency.get(t) ?? 0) + 1);
  const target = [...tokenSet(text)].filter(
    (t) =>
      t.length > 2 &&
      (frequency.get(t) ?? 0) > 0 &&
      (frequency.get(t) ?? 0) <= Math.max(2, candidates.length * 0.3) &&
      !GENERIC.has(t) &&
      !brand.has(t),
  );
  if (target.length === 0) return [];
  return candidates.filter((_, i) => target.some((t) => sets[i].has(t))).slice(0, limit).map((s) => s.ref);
}

/** "www.google.com/travel" → {googl, travel}: the site's own name says nothing about a step. */
function hostWords(url?: string): Set<string> {
  if (!url) return new Set();
  try {
    const u = new URL(url);
    return tokenSet(`${u.hostname.replace(/^www\./, "").replace(/\.[a-z]+$/, "")} ${u.pathname.split("/")[1] ?? ""}`);
  } catch {
    return new Set();
  }
}

const GENERIC = new Set(["click", "check", "view", "get", "find", "detail", "option", "visual", "current", "stat", "full", "result", "try", "navigat", "select", "typ"]);

function repeatedActions(steps: JourneyStep[]): Draft[] {
  // Union steps linked by RETRY/REPEAT flags into clusters.
  const parent = new Map<string, string>();
  const find = (r: string): string => {
    const p = parent.get(r) ?? r;
    if (p === r) return r;
    const root = find(p);
    parent.set(r, root);
    return root;
  };
  for (const step of steps) {
    for (const flag of step.flags) {
      if (flag.kind !== "RETRY" && flag.kind !== "REPEAT") continue;
      for (const related of flag.relatedRefs) parent.set(find(step.ref), find(related));
    }
  }
  const clusters = new Map<string, JourneyStep[]>();
  for (const step of steps) {
    if (!parent.has(step.ref) && ![...parent.values()].includes(step.ref)) continue;
    const root = find(step.ref);
    clusters.set(root, [...(clusters.get(root) ?? []), step]);
  }
  const kept = [...clusters.values()]
    .filter((c) => c.length >= 2)
    // Navigating to the same place again is reported as a route change instead.
    .filter((c) => c.some((s) => s.actionType !== "NAVIGATE" && s.actionType !== "GO_BACK"))
    // Re-reading a page twice is ordinary; interactive repeats are more telling.
    .filter((c) => c.length >= 3 || c.some((s) => s.actionType !== "READ"))
    .sort((a, b) => b.length - a.length || a[0].number - b[0].number);
  const larger = kept.filter((c) => c.length >= 3).slice(0, 3);
  const pairs = kept.filter((c) => c.length === 2);
  const drafts: Draft[] = [];
  if (pairs.length > 1) {
    drafts.push({
      kind: "REPEATED_ACTION",
      title: `${pairs.length} actions were done twice`,
      description: pairs.map((c) => `“${truncate(c[0].statedPurpose, 50)}” (${c.map((s) => s.ref).join(", ")})`).join("; "),
      stepRefs: pairs.flatMap((c) => c.map((s) => s.ref)),
      evidenceRefs: [],
    });
  }
  return [...(pairs.length === 1 ? [...larger, pairs[0]] : larger)]
    .map((cluster): Draft => ({
      kind: "REPEATED_ACTION" as const,
      title: `${cluster.length} similar attempts: “${truncate(cluster[0].statedPurpose, 60)}”`,
      description: `The agent recorded the same or nearly the same purpose at ${formatRefRanges(cluster.map((s) => s.ref))}.`,
      stepRefs: cluster.map((s) => s.ref),
      evidenceRefs: [],
    }))
    .concat(drafts);
}

/** The same control (origin field, prices, filters…) revisited in three or more separate stretches. */
function revisitedControls(steps: JourneyStep[], goal: string): Draft[] {
  const goalWords = ` ${[...tokenSet(goal)].join(" ")} `;
  const mentions = new Map<string, JourneyStep[]>();
  // Only steps where the agent operated the control count, not ones where it read the page.
  for (const step of steps.filter((s) => INTERACTIVE.has(s.actionType))) {
    const words = [...tokenSet(step.statedPurpose)];
    const text = ` ${words.join(" ")} `;
    for (const [stemmed, label] of CONTROL_STEMS) {
      // Words from the goal itself ("destination", "chat") describe the task, not a revisit.
      if (goalWords.includes(` ${stemmed} `)) continue;
      if (text.includes(` ${stemmed} `)) mentions.set(label, [...(mentions.get(label) ?? []), step]);
    }
  }
  const drafts: Array<Draft & { stretches: number }> = [];
  for (const [label, list] of mentions) {
    const stretches: JourneyStep[][] = [];
    for (const step of list) {
      const current = stretches[stretches.length - 1];
      if (current && step.number - current[current.length - 1].number <= 2) current.push(step);
      else stretches.push([step]);
    }
    if (stretches.length < 3 || list.length < 4) continue;
    drafts.push({
      kind: "REPEATED_ACTION",
      title: `Came back to the ${label} ${stretches.length} separate times`,
      description: `Steps involving the ${label}: ${stretches.map((s) => formatRefRanges(s.map((x) => x.ref))).join(", ")}.`,
      stepRefs: list.map((s) => s.ref),
      evidenceRefs: [],
      stretches: stretches.length,
    });
  }
  return drafts
    .sort((a, b) => b.stretches - a.stretches)
    .slice(0, 2)
    .map(({ stretches: _s, ...d }) => {
      void _s;
      return d;
    });
}

function backtracking(steps: JourneyStep[]): Draft[] {
  const back = steps.filter((s) => s.flags.some((f) => f.kind === "BACKTRACK"));
  if (back.length < 2) return [];
  return [
    {
      kind: "BACKTRACKING",
      title: `Went back ${back.length} times`,
      description: back.map((s) => `${s.ref} “${truncate(s.statedPurpose, 60)}”`).join("; "),
      stepRefs: back.map((s) => s.ref),
      evidenceRefs: [],
    },
  ];
}

function routeChanges(steps: JourneyStep[]): Draft[] {
  const drafts: Draft[] = [];
  const restarts = steps.filter((s) => s.actionType === "NAVIGATE" && s.flags.some((f) => f.kind === "REPEAT"));
  if (restarts.length > 0) {
    const firstRelated = restarts[0].flags.find((f) => f.kind === "REPEAT")?.relatedRefs[0];
    drafts.push({
      kind: "ROUTE_CHANGE",
      title: `Started over ${restarts.length} ${plural(restarts.length, "time", "times")}`,
      description: `The agent navigated back to a starting point it had already used${firstRelated ? ` (first at ${firstRelated})` : ""}: ${formatRefRanges(restarts.map((s) => s.ref))}.`,
      stepRefs: [...(firstRelated ? [firstRelated] : []), ...restarts.map((s) => s.ref)],
      evidenceRefs: [],
    });
  }
  const direct = steps.filter((s) => s.flags.some((f) => f.kind === "DIRECT_URL"));
  if (direct.length > 0) {
    drafts.push({
      kind: "ROUTE_CHANGE",
      title: `Went to a page by URL instead of the site's navigation`,
      description: direct.map((s) => `${s.ref} “${truncate(s.statedPurpose, 70)}”`).join("; "),
      stepRefs: direct.map((s) => s.ref),
      evidenceRefs: [],
    });
  }
  return drafts;
}

function interruptions(steps: JourneyStep[]): Draft[] {
  const list = steps.filter((s) => s.flags.some((f) => f.kind === "INTERRUPTION"));
  if (list.length < 2) return [];
  return [
    {
      kind: "UNNECESSARY_STEPS",
      title: `Cleared ${list.length} pop-ups, banners or dialogs`,
      description: list.map((s) => `${s.ref} “${truncate(s.statedPurpose, 60)}”`).join("; "),
      stepRefs: list.map((s) => s.ref),
      evidenceRefs: [],
    },
  ];
}
