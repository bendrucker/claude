import type { Comment } from "./types";

/** Source lines of context on each side of a comment, for the what-on-dense call. */
const CONTEXT_LINES = 8;

/**
 * Build the line-numbered window of source the judge reads around a comment.
 * Takes the file already split into lines so a caller scanning many comments in
 * one file reuses a single split across them all.
 */
export function contextWindow(lines: string[], comment: Comment): string {
  const start = Math.max(1, comment.startLine - CONTEXT_LINES);
  const end = Math.min(lines.length, comment.endLine + CONTEXT_LINES);
  const out: string[] = [];
  for (let n = start; n <= end; n++) out.push(`${n}: ${lines[n - 1]}`);
  return out.join("\n");
}
