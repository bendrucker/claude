export type CommentType = "issue" | "suggestion" | "note" | "praise";
export type CommentSide = "new" | "old";
export type LifecycleState = "local_draft" | "pushed_draft" | "submitted";

export interface TuicrComment {
  id: string;
  location: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  side: CommentSide | null;
  comment_type: CommentType;
  lifecycle_state: LifecycleState;
  created_at?: string;
  content: string;
}

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
  const data = JSON.parse(raw) as { comments: TuicrComment[] } | TuicrComment[];
  return Array.isArray(data) ? data : data.comments;
}
