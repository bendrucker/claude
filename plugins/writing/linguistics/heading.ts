import { LEADING_ENUMERATOR, TRAILING_PARENTHETICAL } from "./preprocess";

export type HeadingKind = "noun-phrase" | "clause" | "imperative" | "interrogative" | "fragment";

export interface HeadingVerdict {
  kind: HeadingKind;
  /** True when the heading reads like a sentence and should be flagged. */
  flagged: boolean;
  /** Human-readable signals supporting the verdict. */
  evidence: string[];
}

export interface HeadingClassifier {
  name: string;
  classify(heading: string): HeadingVerdict;
}

export const LINKING_VERBS = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "holds",
  "hold",
  "keeps",
  "keep",
  "makes",
  "make",
  "becomes",
  "become",
  "handles",
  "handle",
  "supports",
  "support",
]);

export const IMPERATIVE_OPENERS = new Set([
  "build",
  "document",
  "stabilize",
  "expose",
  "add",
  "remove",
  "configure",
  "implement",
  "ensure",
]);

export const ENUMERATOR_STOPLIST =
  /^(step|stage|phase|pattern|example|part|section|option|level|tier|q)\b/i;

export const INTERROGATIVE_OPENERS = new Set([
  "what",
  "why",
  "how",
  "whether",
  "when",
  "where",
  "which",
]);

const NOUN_PHRASE: HeadingVerdict = { kind: "noun-phrase", flagged: false, evidence: [] };

/**
 * Tuned heuristic operating on the heading display text.
 */
export function classifyHeadingBaseline(heading: string): HeadingVerdict {
  const analysis = heading
    .replace(TRAILING_PARENTHETICAL, "")
    .replace(LEADING_ENUMERATOR, "")
    .trim();

  const words = analysis.split(/\s+/).filter((word) => word.length > 0);
  const lower = words.map((word) => word.toLowerCase().replace(/[^a-z']/g, ""));

  // Interrogative-led headings ("Why X is Y", "What was wrong") are a
  // conventional rationale-section label, not the sentence-heading trope.
  if (lower[0] != null && lower[0] !== "" && INTERROGATIVE_OPENERS.has(lower[0])) {
    return { kind: "interrogative", flagged: false, evidence: ["interrogative opener"] };
  }

  const colonIndex = analysis.indexOf(":");
  if (colonIndex !== -1) {
    const before = analysis
      .slice(0, colonIndex)
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const after = analysis
      .slice(colonIndex + 1)
      .trim()
      .split(/\s+/)
      .map((word) => word.toLowerCase().replace(/[^a-z']/g, ""))
      .filter((word) => word.length > 0);
    const afterPredicate = after.some((word) => LINKING_VERBS.has(word) || word === "not");
    const preEnumerator =
      before[0] != null && before[0] !== "" ? ENUMERATOR_STOPLIST.test(before[0]) : false;
    if (before.length <= 4 && after.length >= 3 && afterPredicate && !preEnumerator) {
      return { kind: "clause", flagged: true, evidence: ["colon-gated predicate"] };
    }
  }

  const linkingVerb = lower.find((word) => LINKING_VERBS.has(word));
  if (linkingVerb != null && linkingVerb !== "") {
    return { kind: "clause", flagged: true, evidence: [`linking verb "${linkingVerb}"`] };
  }

  if (
    words.length >= 4 &&
    lower.some((word) => word === "that" || word === "which" || word === "who")
  ) {
    return { kind: "clause", flagged: true, evidence: ["relative clause"] };
  }

  if (
    words.length >= 3 &&
    lower[0] != null &&
    lower[0] !== "" &&
    IMPERATIVE_OPENERS.has(lower[0])
  ) {
    return { kind: "imperative", flagged: true, evidence: [`imperative opener "${lower[0]}"`] };
  }

  return NOUN_PHRASE;
}

export const baselineClassifier: HeadingClassifier = {
  name: "baseline",
  classify: classifyHeadingBaseline,
};
