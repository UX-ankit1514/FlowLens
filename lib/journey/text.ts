/**
 * Small, deterministic text helpers for comparing the agent's short step
 * descriptions ("Click Plan with AI navigation link") with each other and with
 * the agent's end-of-run report. No language model is involved.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "at", "for", "from", "by", "with", "as",
  "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "into", "onto",
  "then", "than", "so", "if", "any", "all", "some", "my", "our", "their", "his", "her", "them", "they",
  "i", "we", "you", "he", "she", "which", "who", "what", "when", "where", "how", "up", "out", "via",
  "after", "before", "about", "over", "under", "still", "also", "just", "only", "not", "no", "yes",
  "can", "could", "would", "should", "will", "did", "do", "does", "has", "have", "had", "there", "here",
  "page", "website", "site", "agent", "user", "visitor",
]);

/** Folds simple English inflections so "clicked", "clicks" and "click" compare equal. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  // "plann" → "plan", "stopp" → "stop"
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !/[aeiou]/.test(w[w.length - 1])) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokens(text));
}

export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** |A∩B| / min(|A|,|B|): 1 when the shorter text is contained in the longer. */
export function overlap(a: Set<string>, b: Set<string>): number {
  const min = Math.min(a.size, b.size);
  return min === 0 ? 0 : intersectionSize(a, b) / min;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = intersectionSize(a, b);
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "S2–S4, S11, S15–S16": compact ranges of consecutive refs with the same prefix. */
export function formatRefRanges(refs: string[]): string {
  const parsed = refs
    .map((r) => ({ ref: r, prefix: r.replace(/\d+$/, ""), n: Number(r.replace(/^\D+/, "")) }))
    .filter((p) => Number.isFinite(p.n));
  const parts: string[] = [];
  let i = 0;
  while (i < parsed.length) {
    let j = i;
    while (j + 1 < parsed.length && parsed[j + 1].prefix === parsed[i].prefix && parsed[j + 1].n === parsed[j].n + 1) j++;
    parts.push(j > i + 0 ? `${parsed[i].ref}–${parsed[j].ref}` : parsed[i].ref);
    i = j + 1;
  }
  return parts.join(", ");
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Extracts a short quote around the first match of `pattern` in `text`. */
export function quoteAround(text: string, pattern: RegExp, radius = 90): string | undefined {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return undefined;
  // Prefer the sentence that contains the match.
  const sentences = text.split(/(?<=[.!?])\s+/);
  let offset = 0;
  for (const sentence of sentences) {
    if (match.index >= offset && match.index < offset + sentence.length + 1) {
      return truncate(sentence, radius * 2);
    }
    offset += sentence.length + 1;
  }
  const start = Math.max(0, match.index - radius);
  return `${start > 0 ? "…" : ""}${truncate(text.slice(start, match.index + radius), radius * 2)}`;
}

/**
 * A short headline from the agent's longer description: the first sentence,
 * cut before qualifying clauses ("…despite setting the location to India").
 */
export function shortTitle(text: string, max = 80): string {
  let t = (/^(.+?[.!?])(\s|$)/.exec(text.trim())?.[1] ?? text).trim().replace(/[.]+$/, "");
  if (t.length > max) {
    const cut = /\s(?:despite|because|although|even though|while|but|which|after|when)\s|[,;:(]/i.exec(t.slice(20));
    if (cut && cut.index !== undefined) t = t.slice(0, 20 + cut.index);
  }
  return truncate(t, max);
}
