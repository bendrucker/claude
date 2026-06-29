import { $ } from "bun";
import { contextWindow } from "./context";
import { type DiffOptions, resolveDiff } from "./diff";
import { extractComments, languageForPath } from "./extract";
import { commentId } from "./identity";
import { type CommentScore, scoreComment } from "./rank";
import { scopeIntroduced } from "./scope";
import { detectTells, type Tell } from "./tells";
import type { Comment, FileDiff, IntroducedComment, Language } from "./types";
import { listTrackedCodeFiles, matchesPathGlobs } from "./walk";

/**
 * One extracted comment carrying everything the judge and the applier need: its
 * stable id, the line-numbered context window, the advisory tells, and its
 * intrinsic complexity score. The unit both scopes (diff and repo) produce.
 */
export interface CollectedComment extends IntroducedComment {
  id: string;
  context: string;
  tells: Tell[];
  score: CommentScore;
}

export interface MrSource {
  projectId: string;
  ref: string;
}

export async function resolveMrSource(iid: string): Promise<MrSource | null> {
  const result = await $`glab mr view ${iid} -F json`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  const record = JSON.parse(result.text()) as Record<string, unknown>;
  const projectId = record.source_project_id;
  const diffRefs = record.diff_refs as Record<string, unknown> | undefined;
  const ref = diffRefs?.head_sha ?? record.sha;
  if (projectId == null || typeof ref !== "string") return null;
  return { projectId: String(projectId), ref };
}

/**
 * The new version of a changed file. Local modes read the working tree (it
 * reflects HEAD plus uncommitted work). An MR is fetched from its source ref.
 */
async function newFileContent(
  path: string,
  options: DiffOptions,
  mrSource: MrSource | null,
): Promise<string | null> {
  if (options.mr && mrSource) {
    const encoded = encodeURIComponent(path);
    const raw =
      await $`glab api projects/${mrSource.projectId}/repository/files/${encoded}/raw?ref=${mrSource.ref}`
        .quiet()
        .nothrow();
    return raw.exitCode === 0 ? raw.text() : null;
  }
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : null;
}

function toCollected(
  path: string,
  language: Language,
  comment: Comment,
  lines: string[],
): CollectedComment {
  return {
    ...comment,
    path,
    language,
    id: commentId(path, comment),
    context: contextWindow(lines, comment),
    tells: detectTells(comment),
    score: scoreComment(comment),
  };
}

async function collectDiffFile(
  file: FileDiff,
  options: DiffOptions,
  mrSource: MrSource | null,
): Promise<CollectedComment[]> {
  const language = languageForPath(file.path);
  if (!language || file.added.length === 0) return [];
  const source = await newFileContent(file.path, options, mrSource);
  if (source == null) {
    console.error(`skipped ${file.path}: could not read new file content`);
    return [];
  }
  const lines = source.split("\n");
  const comments = await extractComments(source, language);
  return scopeIntroduced(comments, file.added).map((comment) =>
    toCollected(file.path, language, comment, lines),
  );
}

export interface CollectOptions {
  pathGlobs?: string[];
}

/**
 * Introduced (diff-scoped) comments across every changed file, read
 * concurrently. `pathGlobs` narrows to matching files before reading, so an
 * unmatched file is never fetched.
 */
export async function collectDiff(
  options: DiffOptions,
  mrSource: MrSource | null,
  collect: CollectOptions = {},
): Promise<CollectedComment[]> {
  const matches = matchesPathGlobs(collect.pathGlobs);
  const diffs = (await resolveDiff(options)).filter((file) => matches(file.path));
  const perFile = await Promise.all(diffs.map((file) => collectDiffFile(file, options, mrSource)));
  return perFile.flat();
}

async function collectRepoFile(path: string): Promise<CollectedComment[]> {
  const language = languageForPath(path);
  if (!language) return [];
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const source = await file.text();
  const lines = source.split("\n");
  const comments = await extractComments(source, language);
  return comments.map((comment) => toCollected(path, language, comment, lines));
}

/** Every comment in every tracked code file, narrowed by `--path` globs. The `--all` scope. */
export async function collectRepo(collect: CollectOptions = {}): Promise<CollectedComment[]> {
  const files = await listTrackedCodeFiles(collect);
  const perFile = await Promise.all(files.map(collectRepoFile));
  return perFile.flat();
}
