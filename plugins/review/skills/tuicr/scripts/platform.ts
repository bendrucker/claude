import { deriveAnchor, type TuicrComment } from "./comment";
import type { ParsedDiff } from "./diff";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Pre-check that a comment's anchor lands on a line the platform will accept.
 * tuicr allows anchoring on unchanged context lines outside the diff, which
 * GitHub rejects with 422 "Line could not be resolved".
 */
export function validateInDiff(comment: TuicrComment, parsed: ParsedDiff): ValidationResult {
  const anchor = deriveAnchor(comment);
  const fileDiff = parsed.get(anchor.path);
  if (!fileDiff) {
    return { ok: false, reason: `File ${anchor.path} is not in the diff` };
  }

  const lineSet = anchor.side === "new" ? fileDiff.newLines : fileDiff.oldLines;
  if (!lineSet.has(anchor.line)) {
    return {
      ok: false,
      reason: `${anchor.side === "new" ? "New" : "Old"}-side line ${anchor.line} of ${anchor.path} is not within a diff hunk`,
    };
  }

  return { ok: true };
}

export interface GitHubComment {
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  commit_id: string;
  body: string;
}

/** Map a comment to a GitHub review-comment payload. new-side -> RIGHT, old-side -> LEFT. */
export function toGitHubComment(comment: TuicrComment, opts: { commitId: string }): GitHubComment {
  const anchor = deriveAnchor(comment);
  return {
    path: anchor.path,
    line: anchor.line,
    side: anchor.side === "new" ? "RIGHT" : "LEFT",
    commit_id: opts.commitId,
    body: comment.content,
  };
}

export interface GitLabRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface GitLabPosition {
  position_type: "text";
  base_sha: string;
  head_sha: string;
  start_sha: string;
  new_path: string;
  old_path: string;
  new_line?: number;
  old_line?: number;
}

/**
 * Map a comment to a GitLab discussion `position`. Sets `new_line` for new-side
 * anchors and `old_line` for old-side. `old_path` defaults to `new_path` when
 * the file is not a rename.
 */
export function toGitLabPosition(
  comment: TuicrComment,
  refs: GitLabRefs,
  opts: { newPath: string; oldPath?: string },
): GitLabPosition {
  const anchor = deriveAnchor(comment);
  const position: GitLabPosition = {
    position_type: "text",
    base_sha: refs.base_sha,
    head_sha: refs.head_sha,
    start_sha: refs.start_sha,
    new_path: opts.newPath,
    old_path: opts.oldPath ?? opts.newPath,
  };

  if (anchor.side === "new") {
    position.new_line = anchor.line;
  } else {
    position.old_line = anchor.line;
  }

  return position;
}
