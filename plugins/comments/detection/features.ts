import type { Comment } from "./types";

/**
 * Deterministic per-comment features, logged next to the verdicts each run so
 * production runs accumulate (features, verdict) pairs. Once enough pairs
 * exist, thresholds fitted on them can route obvious comments away from the
 * judge; until then the features are descriptive and gate nothing.
 */
export interface CommentFeatures {
  lines: number;
  chars: number;
  /**
   * Fraction of the comment's content words whose stem also appears in the
   * identifiers of the surrounding code. High alignment on a short comment is
   * the restate-the-what shape.
   */
  codeAlignment: number;
  /** The comment carries a why-shaped connective (because, workaround, until). */
  whyMarker: boolean;
  /** The comment names a ticket (ABC-123) or issue (#123). */
  ticketId: boolean;
  /** Some line is a punctuation rule: the section-divider shape. */
  dividerRule: boolean;
}

/** Words too common to signal alignment between a comment and its code. */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "is",
  "are",
  "was",
  "this",
  "that",
  "it",
  "its",
  "with",
  "on",
  "be",
  "we",
  "as",
  "by",
  "from",
  "not",
  "if",
  "when",
  "then",
  "so",
  "at",
  "one",
  "each",
  "all",
]);

/**
 * Crude suffix stemmer: one pass, longest suffix first, keeping stems of three
 * or more characters. Enough to line up `creates`/`created` with a `create`
 * identifier without a stemming dependency.
 */
function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s", "e"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/** Lowercased, stemmed content words of the comment, delimiters and stopwords dropped. */
function contentWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.filter((word) => word.length >= 3 && STOPWORDS.has(word) === false).map(stem);
}

/** Stemmed word set of the code's identifiers, camelCase and snake_case split apart. */
function identifierTokens(code: string): Set<string> {
  const tokens = new Set<string>();
  for (const identifier of code.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) {
    for (const part of identifier.split(/_+|(?<=[a-z0-9])(?=[A-Z])/)) {
      const word = part.toLowerCase();
      if (word.length >= 3) tokens.add(stem(word));
    }
  }
  return tokens;
}

const WHY_MARKER =
  /\b(because|so that|otherwise|workaround|avoids?|until|instead|must|cannot|can't|intentional(ly)?|deliberate(ly)?)\b/i;

const TICKET_ID = /\b[A-Z][A-Z0-9]{1,9}-\d+\b|#\d{2,}/;

/** A line that is only a run of rule punctuation, after its delimiter. */
const DIVIDER_RULE = /^\s*(?:\/\/|\/\*|--|#|\*|;)?\s*[-=*#_~+]{8,}\s*(?:\*\/)?\s*$/;

/** Lines of code adjacent to the comment, excluding the comment's own span. */
function surroundingCode(lines: string[], comment: Comment, radius: number): string {
  const start = Math.max(1, comment.startLine - radius);
  const end = Math.min(lines.length, comment.endLine + radius);
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    if (n >= comment.startLine && n <= comment.endLine) continue;
    out.push(lines[n - 1] ?? "");
  }
  return out.join("\n");
}

/** Source lines considered on each side of the comment for alignment. */
const ALIGNMENT_RADIUS = 8;

export function commentFeatures(comment: Comment, lines: string[]): CommentFeatures {
  const words = contentWords(comment.text);
  const identifiers = identifierTokens(surroundingCode(lines, comment, ALIGNMENT_RADIUS));
  const matched = words.filter((word) => identifiers.has(word)).length;
  return {
    lines: comment.endLine - comment.startLine + 1,
    chars: comment.text.length,
    codeAlignment: words.length === 0 ? 0 : matched / words.length,
    whyMarker: WHY_MARKER.test(comment.text),
    ticketId: TICKET_ID.test(comment.text),
    dividerRule: comment.text.split("\n").some((line) => DIVIDER_RULE.test(line)),
  };
}
