import { createHash } from "node:crypto";
import type { Comment } from "./types";

/**
 * A stable id threading one comment from extraction through judging to apply.
 * Keyed on path plus position plus text, so re-extracting the same file yields
 * the same id, and any drift in the comment's text or position yields a
 * different one (the apply step relies on that to detect a stale range).
 */
export function commentId(path: string, comment: Comment): string {
  const key = `${path}:${comment.startLine}:${comment.startColumn}:${comment.text}`;
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
}
