import type { Comment, LineRange } from "./types";

/**
 * True when the comment's line span [startLine, endLine] shares at least one
 * line with the range [start, end]. All bounds are 1-based inclusive, so the
 * predicate is an inclusive interval overlap: the comment must start no later
 * than the range ends and end no earlier than the range starts.
 */
export function overlaps(comment: Comment, range: LineRange): boolean {
  return comment.startLine <= range.end && comment.endLine >= range.start;
}

/**
 * Keep only the comments a change introduced: those whose line span intersects
 * any added/modified range. Pre-existing comments fall outside every range and
 * are dropped. Input order is preserved and inputs are not mutated.
 */
export function scopeIntroduced(comments: Comment[], added: LineRange[]): Comment[] {
  return comments.filter((comment) => added.some((range) => overlaps(comment, range)));
}
