import { z } from "zod";

export const CommentType = z.enum(["issue", "suggestion", "note", "praise"]);
export type CommentType = z.infer<typeof CommentType>;
export const CommentSide = z.enum(["new", "old"]);
export type CommentSide = z.infer<typeof CommentSide>;
export const LifecycleState = z.enum(["local_draft", "pushed_draft", "submitted"]);
export type LifecycleState = z.infer<typeof LifecycleState>;

export const TuicrComment = z.looseObject({
  id: z.string(),
  location: z.string(),
  path: z.string().nullable(),
  start_line: z.number().nullable(),
  end_line: z.number().nullable(),
  side: CommentSide.nullable(),
  comment_type: CommentType,
  lifecycle_state: LifecycleState,
  created_at: z.string().optional(),
  content: z.string(),
});
export type TuicrComment = z.infer<typeof TuicrComment>;

const CommentPayload = z.union([
  z.looseObject({ comments: z.array(TuicrComment) }),
  z.array(TuicrComment),
]);

export interface Anchor {
  side: CommentSide;
  line: number;
  path: string;
}

/**
 * Resolve a comment's anchor from tuicr's `side`/`start_line`/`path` fields.
 * tuicr stamps `side` directly, so trust it; default to the new side when a
 * line-anchored comment omits it.
 */
export function deriveAnchor(comment: TuicrComment): Anchor {
  if (comment.path === null || comment.start_line === null) {
    throw new Error("comment has no anchor");
  }
  return {
    side: comment.side ?? "new",
    line: comment.start_line,
    path: comment.path,
  };
}

/** Decode a comments JSON payload, accepting either `{ comments: [...] }` or a bare array. */
export function decodeComments(raw: string): TuicrComment[] {
  const data = CommentPayload.parse(JSON.parse(raw));
  return Array.isArray(data) ? data : data.comments;
}
