import type { ActionType, TechnicalBlockerKind } from "@/types";

/**
 * Wording-based classification of the agent's step descriptions and reports.
 * Everything here is a label derived from text the agent wrote; the UI says so.
 */

/* ------------------------------------------------------------------------ */
/* Technical / automation-environment detection                             */
/* ------------------------------------------------------------------------ */

const BOT_PROTECTION =
  /\b(captcha|recaptcha|hcaptcha|datadome|cloudflare|perimeterx|imperva|incapsula|akamai bot|bot[\s-]*(?:detection|protection|check|block|blocker|challenge|wall)|anti[\s-]?bot|human verification|verify (?:that )?you are (?:a )?human|are you a robot|access (?:is )?(?:temporarily )?(?:restricted|denied)|soft block|rate[\s-]?limit(?:ed|ing)?|automated (?:traffic|access|browsing))\b/i;

const PROXY_OR_NETWORK =
  /\b(proxy|vpn|reconfigur\w*|browser configuration|network error|connection (?:error|reset|refused|timed out|lost)|net::err\w*|err_[a-z_]+|dns (?:error|failure)|ssl (?:error|failure)|certificate error)\b/i;

const AGENT_ENVIRONMENT =
  /\b(invalid_argument|internal (?:server )?error|tool error|model error|agent (?:crashed|error)|browser (?:crash\w*|closed unexpectedly)|retryable error|run failed after \d+ attempts)\b/i;

/** Any technical wording, for quoting the relevant part of a note. */
export const TECHNICAL_ANY = new RegExp(`${BOT_PROTECTION.source}|${PROXY_OR_NETWORK.source}|${AGENT_ENVIRONMENT.source}`, "i");

/** Returns a technical category when the text describes the test environment rather than the design. */
export function classifyTechnical(text: string | undefined): TechnicalBlockerKind | undefined {
  return classifyTechnicalAll(text)[0];
}

/** Every technical category the text mentions ("bypassed DataDome with a US proxy" → both). */
export function classifyTechnicalAll(text: string | undefined): TechnicalBlockerKind[] {
  if (!text) return [];
  const kinds: TechnicalBlockerKind[] = [];
  if (BOT_PROTECTION.test(text)) kinds.push("BOT_PROTECTION");
  if (PROXY_OR_NETWORK.test(text)) kinds.push("PROXY_OR_NETWORK");
  if (AGENT_ENVIRONMENT.test(text)) kinds.push("AGENT_ENVIRONMENT");
  return kinds;
}

export const TECHNICAL_KIND_LABEL: Record<TechnicalBlockerKind, string> = {
  BOT_PROTECTION: "Bot protection",
  PROXY_OR_NETWORK: "Proxy or network",
  AGENT_ENVIRONMENT: "Agent environment",
  SITE_UNREACHABLE: "Site unreachable",
  LOGIN_REQUIRED: "Sign-in required",
  REAL_WORLD_ACTION: "Real-world action",
};

/* ------------------------------------------------------------------------ */
/* Step wording                                                             */
/* ------------------------------------------------------------------------ */

const BACKTRACK = /^(?:go(?:ing)?\s+back|return(?:ed|ing)?\s+to|back\s+to|navigate\s+back|head\s+back|went\s+back)\b/i;
const RETRY_WORDING = /\b(again|retry|re-?try|re-?check|re-?enter|re-?do|re-?open|one more time|second attempt)\b/i;
const ERROR_WORDING = /\b(error|broken|fix(?:es|ed)?\b|failed to|not (?:working|loading|responding)|didn'?t (?:work|load|respond)|does ?n[o']t (?:work|load|respond)|crash\w*|blank page)\b/i;
const DIRECT_URL = /\b(directly|direct url|via (?:the )?url|(?:type|enter)(?:ed)? (?:the |a )?url)\b/i;
const INTERRUPTION_NOUNS =
  /\b(cookie|consent|banner|pop-?ups?|newsletter|survey|feedback|notification|promo\w*|advert\w*|language selection|location prompt|chat widget|recommendation popup)\b/i;
const DISMISS_VERB = /^(?:try (?:to )?)?(dismiss|close|cancel|accept|reject|decline|skip)\b/i;

export function isBacktrack(purpose: string): boolean {
  return BACKTRACK.test(purpose.trim());
}

export function hasRetryWording(purpose: string): boolean {
  return RETRY_WORDING.test(purpose);
}

export function hasErrorWording(purpose: string): boolean {
  return ERROR_WORDING.test(purpose);
}

export function isDirectUrl(purpose: string): boolean {
  return DIRECT_URL.test(purpose);
}

/** Pop-ups, banners and similar things the agent had to clear out of the way. */
export function interruptionNoun(purpose: string): string | undefined {
  const trimmed = purpose.trim();
  const verb = DISMISS_VERB.exec(trimmed);
  if (!verb) return undefined;
  const noun = INTERRUPTION_NOUNS.exec(trimmed);
  if (noun) return noun[1].toLowerCase();
  // "Dismiss the dialog" is an interruption; "Close the date picker" is not.
  if (/^dismiss\b/i.test(trimmed) && /\b(dialog|modal|overlay|prompt)\b/i.test(trimmed)) return "dialog";
  return undefined;
}

/** Matches a verb in its base, -s, -ed and -ing forms ("navigate", "navigating", "tapped"). */
function verbForms(bases: string[]): string {
  return bases
    .map((base) => {
      if (base.endsWith("e")) return `${base.slice(0, -1)}(?:e|es|ed|ing)`;
      const last = base[base.length - 1];
      return `${base}(?:${last}(?:ed|ing))?(?:s|es|ed|ing)?`;
    })
    .join("|");
}

const ACTION_VERBS: Array<[RegExp, ActionType]> = (
  [
    [["reload", "refresh"], "RELOAD"],
    [["wait"], "WAIT"],
    [["scroll"], "SCROLL"],
    [["dismiss", "close", "cancel", "accept", "reject", "decline", "skip"], "DISMISS"],
    [["search"], "SEARCH"],
    [["type", "enter", "fill", "input", "write"], "TYPE"],
    [["select", "choose", "pick", "set", "change", "switch", "toggle", "apply", "filter", "sort", "confirm", "adjust", "update"], "SELECT"],
    [["click", "tap", "press", "hit", "open", "expand"], "CLICK"],
    [["focus"], "FOCUS"],
    [["submit", "send", "finish", "complete", "report", "save"], "SUBMIT"],
    [["navigate", "visit", "go", "access", "load", "launch", "start", "proceed"], "NAVIGATE"],
    [
      [
        "understand", "extract", "get", "check", "read", "view", "see", "inspect", "look", "find", "review",
        "verify", "explore", "examine", "identify", "observe", "analyze", "analyse", "locate", "scan",
        "capture", "note", "take", "compare", "evaluate", "determine", "study", "assess",
      ],
      "READ",
    ],
  ] as Array<[string[], ActionType]>
).map(([bases, type]) => [new RegExp(`^(?:${verbForms(bases)})\\b`, "i"), type] as [RegExp, ActionType]);

/** The kind of browser action, inferred from the first verb of the stated purpose. */
export function inferActionType(purpose: string): ActionType {
  const text = purpose.trim();
  if (isBacktrack(text)) return "GO_BACK";
  // "Try clicking the Ask AI button" → "clicking the Ask AI button"
  const core = text.replace(/^(?:try|tries|trying|attempt|attempting)\s+(?:to\s+)?/i, "");
  for (const [pattern, type] of ACTION_VERBS) {
    if (pattern.test(core)) return type;
  }
  return "OTHER";
}

/** Steps of the same kind of action can repeat each other; a click then a typed entry is one task, not a retry. */
export function actionFamily(type: ActionType): string {
  switch (type) {
    case "CLICK":
    case "SELECT":
      return "choose";
    case "NAVIGATE":
    case "GO_BACK":
      return "navigate";
    default:
      return type;
  }
}

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  NAVIGATE: "Navigate",
  CLICK: "Click",
  TYPE: "Type",
  SELECT: "Select",
  SEARCH: "Search",
  READ: "Read page",
  SCROLL: "Scroll",
  WAIT: "Wait",
  DISMISS: "Dismiss",
  SUBMIT: "Submit",
  GO_BACK: "Go back",
  RELOAD: "Reload",
  FOCUS: "Focus",
  OTHER: "Other",
};

/** Words in the agent's note that conflict with a criterion reported as met. */
export const CONTRADICTION_WORDING =
  /\b(could not|couldn'?t|unable to|not able to|failed to|was not (?:found|shown|visible|available|displayed)|wasn'?t (?:found|shown|visible|available|displayed)|were not (?:found|shown|visible|available|displayed)|did not (?:find|work|load|show|appear)|didn'?t (?:find|work|load|show|appear)|unavailable|not verified|no (?:results?|options?|prices?) (?:were |was )?(?:found|shown|available))\b/i;
