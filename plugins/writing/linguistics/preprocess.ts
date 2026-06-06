import { CODE_SENTINEL } from "./tags";

/** Trailing parenthetical citation: "Token Exchange (RFC 8693)". */
export const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/;

/** Leading enumerator: "Step 1:", "Phase: Calendar", "Example: Blog Schema". */
export const LEADING_ENUMERATOR =
  /^(step|stage|phase|pattern|example|part|section|option|level|tier|q)\s*\d*\s*:?\s*/i;

/**
 * Code-identifier shapes, replaced with CODE_SENTINEL before tagging so
 * the tagger sees a plain noun-like token instead of jargon it will
 * mis-tag. Ordered: spans first, then multi-char shapes, then flags.
 */
const CODE_PATTERNS: RegExp[] = [
  /`[^`]+`/g, // inline code spans
  /\b[A-Z]{2,}-\d+\b/g, // ticket IDs
  /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/g, // paths
  /\b[\w.-]+\.(?:ts|js|tsx|jsx|json|jsonl|md|txt|yml|yaml|toml|sh|py|go|rs|sql|css|html)\b/g, // filenames
  /\b[A-Za-z_][A-Za-z0-9_]*\(\)/g, // function calls
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, // SCREAMING_SNAKE
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g, // snake_case
  /\b[A-Za-z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/g, // camelCase/PascalCase
  /(?<=\s|^)--?[a-zA-Z][\w-]*/g, // CLI flags
];

/**
 * Title-cased dictionary word: capital followed by lowercase. Acronyms
 * (API, HTTP) and the CODE sentinel never match and keep their case.
 */
const TITLE_CASED_WORD = /\b[A-Z][a-z'’-]*\b/g;

export interface PreprocessResult {
  text: string;
  /** Number of code identifiers replaced with the sentinel. */
  codeSpans: number;
  /**
   * A leading enumerator ("Step 1:") was stripped. Step headings are
   * imperative by convention, so imperative rules should not fire.
   */
  enumerator: boolean;
}

/**
 * Normalize a heading for POS tagging: strip the trailing parenthetical
 * and leading enumerator, replace code identifiers with a noun-like
 * sentinel, and lowercase title-cased words so the tagger does not read
 * Title Case as proper nouns.
 */
export function preprocessHeading(raw: string): PreprocessResult {
  const stripped = raw.replace(TRAILING_PARENTHETICAL, "").trim();
  let text = stripped.replace(LEADING_ENUMERATOR, "").trim();
  const enumerator = text !== stripped;

  let codeSpans = 0;
  for (const pattern of CODE_PATTERNS) {
    text = text.replace(pattern, () => {
      codeSpans++;
      return CODE_SENTINEL;
    });
  }

  text = text.replace(TITLE_CASED_WORD, (word) => word.toLowerCase());

  return { text: text.trim(), codeSpans, enumerator };
}
