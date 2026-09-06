import { z } from "zod";

export const CommentType = z.enum(["issue", "suggestion", "note", "praise"]);
export type CommentType = z.infer<typeof CommentType>;
export const CommentSide = z.enum(["new", "old"]);
export type CommentSide = z.infer<typeof CommentSide>;
export const ReviewComment = z.looseObject({
  id: z.string(),
  path: z.string().nullable(),
  start_line: z.number().nullable(),
  end_line: z.number().nullable(),
  side: CommentSide.nullable(),
  comment_type: CommentType,
  content: z.string(),
});
export type ReviewComment = z.infer<typeof ReviewComment>;

const CommentPayload = z.union([
  z.looseObject({ comments: z.array(ReviewComment) }),
  z.array(ReviewComment),
]);

export interface Anchor {
  side: CommentSide;
  line: number;
  path: string;
}

/**
 * Resolve a comment's anchor from its `side`/`start_line`/`path` fields.
 * Default to the new side when a line-anchored comment omits it.
 */
export function deriveAnchor(comment: ReviewComment): Anchor {
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
export function decodeComments(raw: string): ReviewComment[] {
  const data = CommentPayload.parse(JSON.parse(raw));
  return Array.isArray(data) ? data : data.comments;
}
