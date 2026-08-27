import { z } from "zod";
import { commentId } from "../detection/identity";
import type { Comment } from "../detection/types";
import { parseVerdict } from "../judge/judge";
import type { Verdict } from "../judge/schema";

const ShardEntry = z.looseObject(
  { id: z.string({ error: "entry id must be a string" }), verdict: z.unknown().optional() },
  { error: "entry must be an object" },
);

const Shard = z.looseObject(
  { verdicts: z.array(ShardEntry, { error: `missing "verdicts" array` }) },
  { error: "must be a JSON object" },
);

/**
 * Fold the verdict shards the agents wrote into one id→verdict map, validating
 * each verdict's shape and rejecting a duplicate id. A malformed agent verdict is
 * a hard error here rather than silently corrupting a file at apply time.
 */
export function collectVerdicts(shards: unknown[]): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const shard of shards) {
    const parsed = Shard.safeParse(shard);
    if (!parsed.success) {
      throw new Error(`Verdict shard ${parsed.error.issues[0]?.message}`);
    }
    for (const entry of parsed.data.verdicts) {
      if (map.has(entry.id)) throw new Error(`Verdict id ${entry.id} appears more than once`);
      map.set(entry.id, parseVerdict(entry.verdict, entry.id));
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
