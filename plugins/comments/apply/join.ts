import { commentId } from "../detection/identity";
import type { Comment } from "../detection/types";
import { parseVerdict } from "../judge/judge";
import type { Verdict } from "../judge/schema";

/**
 * Fold the verdict shards the agents wrote into one id→verdict map, validating
 * each verdict's shape and rejecting a duplicate id. A malformed agent verdict is
 * a hard error here rather than silently corrupting a file at apply time.
 */
export function collectVerdicts(shards: unknown[]): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const shard of shards) {
    if (typeof shard !== "object" || shard === null) {
      throw new Error("Verdict shard must be a JSON object");
    }
    const entries = (shard as Record<string, unknown>).verdicts;
    if (!Array.isArray(entries)) throw new Error('Verdict shard missing "verdicts" array');
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("Verdict entry must be an object");
      }
      const record = entry as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== "string") throw new Error("Verdict entry id must be a string");
      if (map.has(id)) throw new Error(`Verdict id ${id} appears more than once`);
      map.set(id, parseVerdict(record.verdict, id));
    }
  }
  return map;
}

/** A re-extracted comment paired with the verdict that named its id. */
export interface CommentMatch {
  id: string;
  comment: Comment;
  verdict: Verdict;
}

/**
 * Match verdicts to freshly extracted comments by recomputing each comment's id.
 * A comment whose id carries a verdict is matched at its current range. The id
 * encodes path, position, and text, so a comment that moved or changed since
 * preflight yields a new id, finds no verdict, and is left untouched. The id
 * match is the drift check.
 */
export function matchVerdicts(
  path: string,
  comments: Comment[],
  verdicts: Map<string, Verdict>,
): CommentMatch[] {
  const matches: CommentMatch[] = [];
  for (const comment of comments) {
    const id = commentId(path, comment);
    const verdict = verdicts.get(id);
    if (verdict) matches.push({ id, comment, verdict });
  }
  return matches;
}
