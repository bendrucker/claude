import { INTERROGATIVE_OPENERS, LINKING_VERBS } from "./linguistics/heading";
import { CODE_SENTINEL } from "./linguistics/tags";

export interface PrHeadingResult {
  flagged: boolean;
  signals: string[];
}

/**
 * Code-identifier shapes. A heading made mostly of these (plus a short
 * label) is fine. Each match is replaced with a sentinel so case/verb checks
 * do not read `auth status`, `--format`, or `text_content` as English.
 */
const CODE_PATTERNS: RegExp[] = [
  /`[^`]+`/g,
  /\b[A-Z]{2,}-\d+\b/g,
  /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/g,
  /\b[\w.-]+\.(?:ts|js|tsx|jsx|json|jsonl|md|txt|yml|yaml|toml|sh|py|go|rs|sql|css|html)\b/g,
  /\b[A-Za-z_][A-Za-z0-9_]*\(\)/g,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g,
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g,
  /(?<=\s|^)--?[a-zA-Z][\w-]*/g,
];

function maskCode(text: string): string {
  let masked = text;
  for (const pattern of CODE_PATTERNS) {
    masked = masked.replace(pattern, CODE_SENTINEL);
  }
  return masked;
}

/**
 * Finite verbs that turn a noun phrase into a sentence/predicate. Beyond
 * the linking-verb set, these are the third-person and base forms seen in
 * the bad-labeled headings ("Exits Non-Zero", "What it Finds", "Why This
 * Happens", "no longer Uses lift").
 */
const PREDICATE_VERBS = new Set([
  ...LINKING_VERBS,
  "exit",
  "exits",
  "need",
  "needs",
  "happen",
  "happens",
  "work",
  "works",
  "add",
  "adds",
  "find",
  "finds",
  "fix",
  "fixes",
  "use",
  "uses",
  "send",
  "sends",
  "sending",
  "supersede",
  "supersedes",
  "applied",
  "left",
  "owned",
  "sourced",
  "scoped",
  "found",
  "closes",
  "refs",
  "does",
  "do",
  "join",
  "joins",
  "block",
  "blocks",
  "remind",
  "reminds",
  "added",
  "removed",
  "made",
]);

const SUBJECT_PRONOUNS = new Set([
  "it",
  "this",
  "that",
  "these",
  "those",
  "they",
  "what",
  "i",
  "we",
  "you",
]);

const RELATIVE_PRONOUNS = new Set(["that", "which", "who"]);

function tokens(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

/**
 * Is this token a "content" word that should be Title Cased in a good
 * heading? Skips the sentinel, code-looking tokens, small function words,
 * and pure punctuation.
 */
const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "via",
  "with",
  "from",
  "into",
  "per",
  "not",
  "no",
  "vs",
  "vs.",
  "as",
]);

function isContentWord(word: string): boolean {
  const bare = word.replace(/[.,:?!"'()]/g, "");
  if (bare === CODE_SENTINEL) return false;
  if (bare.length === 0) return false;
  // Tokens with internal code shape (digits, slashes, backticks) are not prose.
  if (/[`/_]/.test(word) || /\d/.test(bare)) return false;
  if (/^[A-Z0-9]+$/.test(bare)) return false; // acronym, fine
  return !FUNCTION_WORDS.has(bare.toLowerCase());
}

export function classifyPrHeading(heading: string): PrHeadingResult {
  const signals: string[] = [];
  const raw = heading.trim();

  if (/\?\s*$/.test(raw)) signals.push("trailing question mark");
  if (/[.](?<!\.\.\.)\s*$/.test(raw) && !/\b[A-Z]\.$/.test(raw)) signals.push("trailing period");

  // A comma outside code/quotes signals list/clause structure. The contrast idiom ", not Y" is a
  // tight label device the user keeps ("`-F`, not `-f`"), so it is exempt.
  const maskedForComma = maskCode(raw)
    .replace(/"[^"]*"/g, CODE_SENTINEL)
    .replace(/,\s*not\b/gi, "");
  if (/,/.test(maskedForComma)) signals.push("comma (clause/list)");

  // A short label parenthetical is fine ("(Historical)", "(Working Notes)"). Flag parentheticals
  // that contain a comma or a predicate verb (a clause).
  const parenMatch = raw.match(/\(([^)]*)\)/);
  if (parenMatch) {
    const inner = parenMatch[1] ?? "";
    const innerMasked = maskCode(inner);
    const innerWords = tokens(innerMasked).map(normalize);
    const hasComma = /,/.test(innerMasked.replace(/"[^"]*"/g, CODE_SENTINEL));
    const hasPredicate = innerWords.some((w) => PREDICATE_VERBS.has(w));
    if (hasComma) signals.push("parenthetical clause (comma)");
    else if (hasPredicate) signals.push("parenthetical clause (verb)");
  }

  const noParen = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const masked = maskCode(noParen);
  const toks = tokens(masked);
  const lower = toks.map(normalize);

  // "Why / What / How ..." headings are rationale-section labels in this corpus and the user marks
  // the overwhelming majority bad. Flag them, but require a real verb/object tail so a bare "How It
  // Works" idiom still gets caught (it is also bad here) while not over-firing on noun labels.
  const firstStem = lower[0]?.replace(/'s$/, "");
  if (
    firstStem != null &&
    firstStem !== "" &&
    INTERROGATIVE_OPENERS.has(firstStem) &&
    lower.length >= 2
  ) {
    signals.push(`interrogative opener "${firstStem}"`);
  }

  const predicate = lower.find((w) => PREDICATE_VERBS.has(w));
  if (predicate != null && predicate !== "") signals.push(`predicate verb "${predicate}"`);

  if (toks.length >= 3 && lower.some((w) => RELATIVE_PRONOUNS.has(w))) {
    signals.push("relative clause");
  }

  if (lower.some((w) => SUBJECT_PRONOUNS.has(w) && w !== "that" && w !== "what")) {
    signals.push("sentence subject pronoun");
  }

  // A good heading Title-Cases content words. A lowercase content word past the first position
  // means the heading is sentence case. One such word is enough ("Headless fallback", "Note for the
  // reviewer"); the first word is weighted separately because some good labels open lowercase by
  // accident.
  const lowercaseContent = toks.slice(1).filter((t) => isContentWord(t) && /^[a-z]/.test(t));
  const firstLower =
    toks[0] != null && toks[0] !== "" && isContentWord(toks[0]) && /^[a-z]/.test(toks[0])
      ? [toks[0]]
      : [];
  const lowered = [...firstLower, ...lowercaseContent];
  if (lowercaseContent.length >= 1 || lowered.length >= 2) {
    signals.push(`sentence case (${lowered.length} lowercase content words)`);
  }

  // Very long headings read as sentences. Count prose tokens (exclude code sentinel) so a code-
  // heavy label is not penalized.
  const proseLen = toks.filter((t) => t !== CODE_SENTINEL).length;
  if (proseLen >= 8) signals.push(`long (${proseLen} prose words)`);

  return { flagged: signals.length > 0, signals };
}
