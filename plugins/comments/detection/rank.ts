import type { Comment } from "./types";

/**
 * Intrinsic complexity of a single comment, measured from the comment alone and
 * never relative to the surrounding code. A slop-heavy repo surfaces its
 * longest, densest comments first when shards are built in ranked order.
 */
export interface CommentScore {
  /** 1-based inclusive line span. */
  lines: number;
  chars: number;
  /** Weighted blend dominated by char count, with a line-span boost. */
  score: number;
}

export type SortKey = "lines" | "chars" | "score";

/** Each comment line beyond the first adds this much to the blended score. */
const LINE_WEIGHT = 20;

export function scoreComment(comment: Comment): CommentScore {
  const lines = comment.endLine - comment.startLine + 1;
  const chars = comment.text.length;
  const score = chars + lines * LINE_WEIGHT;
  return { lines, chars, score };
}

/**
 * Return a sorted copy of the comments, descending by the chosen key. Sorting is
 * stable, so comments that tie keep their input order. Inputs are not mutated.
 */
export function rankComments<T extends Comment>(comments: T[], sort: SortKey = "score"): T[] {
  return comments
    .map((comment) => ({ comment, score: scoreComment(comment) }))
    .toSorted((a, b) => b.score[sort] - a.score[sort])
    .map((entry) => entry.comment);
}
