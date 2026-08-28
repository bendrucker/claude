import { $ } from "bun";
import { z } from "zod";
import { contextWindow } from "./context";
import { measureAddedLines, type ScoredFile } from "./density";
import { type DiffOptions, resolveDiff } from "./diff";
import { isExemptComment } from "./exempt";
import { extractComments, languageForPath } from "./extract";
import { type CommentFeatures, commentFeatures } from "./features";
import { commentId } from "./identity";
import { type CommentScore, scoreComment } from "./rank";
import { scopeIntroduced } from "./scope";
import type { Comment, FileDiff, IntroducedComment, Language } from "./types";
import { isVendoredPath, listTrackedCodeFiles, listVendoredRoots, matchesPathGlobs } from "./walk";

/**
 * One extracted comment carrying everything the judge needs: its stable id, the
 * line-numbered context window, and its intrinsic complexity score. The unit both
 * scopes (diff and repo) produce.
 */
export interface CollectedComment extends IntroducedComment {
  id: string;
  context: string;
  score: CommentScore;
  features: CommentFeatures;
}

/** A header marker that announces a file is machine-written. */
const GENERATED_MARKER = /@generated|do not edit/i;

/**
 * Generated files carry machine-written comments the audit must never touch.
 * Skip TypeScript declaration files and any file whose head announces it is
 * generated. Only the head is scanned so a deep comment that happens to say "do
 * not edit this line" does not exempt a hand-written file.
 */
export function isGeneratedFile(path: string, source: string): boolean {
  if (path.endsWith(".d.ts")) return true;
  return GENERATED_MARKER.test(source.slice(0, 2000));
}

export interface MrSource {
  projectId: string;
  ref: string;
}

const MrView = z.looseObject({
  source_project_id: z.union([z.number(), z.string()]).nullish(),
  diff_refs: z.looseObject({ head_sha: z.string().nullish() }).nullish(),
  sha: z.string().nullish(),
});

export async function resolveMrSource(iid: string): Promise<MrSource | null> {
  const result = await $`glab mr view ${iid} -F json`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  const view = MrView.safeParse(JSON.parse(result.text()));
  if (!view.success) return null;
  const projectId = view.data.source_project_id;
  const ref = view.data.diff_refs?.head_sha ?? view.data.sha;
  if (projectId == null || ref == null) return null;
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
  if (options.mr != null && options.mr !== "" && mrSource) {
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
    score: scoreComment(comment),
    features: commentFeatures(comment, lines),
  };
}

async function collectDiffFile(
  file: FileDiff,
  options: DiffOptions,
  mrSource: MrSource | null,
  onDensity?: (file: ScoredFile) => void,
): Promise<CollectedComment[]> {
  const language = languageForPath(file.path);
  if (language == null || language === "" || file.added.length === 0) return [];
  const source = await newFileContent(file.path, options, mrSource);
  if (source == null) {
    console.error(`skipped ${file.path}: could not read new file content`);
    return [];
  }
  if (isGeneratedFile(file.path, source)) return [];
  if (onDensity) {
    const added = new Set<number>();
    for (const range of file.added) {
      for (let n = range.start; n <= range.end; n++) added.add(n);
    }
    onDensity({ path: file.path, language, stats: await measureAddedLines(source, added, language) });
  }
  const lines = source.split("\n");
  const comments = await extractComments(source, language);
  return scopeIntroduced(comments, file.added)
    .filter((comment) => !isExemptComment(comment))
    .map((comment) => toCollected(file.path, language, comment, lines));
}

export interface CollectOptions {
  pathGlobs?: string[];
  /** Receives each collected file's added-line density stats as it is read. */
  onFileDensity?: (file: ScoredFile) => void;
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
  const [resolved, vendoredRoots] = await Promise.all([resolveDiff(options), listVendoredRoots()]);
  const diffs = resolved.filter(
    (file) => matches(file.path) && !isVendoredPath(file.path, vendoredRoots),
  );
  const perFile = await Promise.all(
    diffs.map((file) => collectDiffFile(file, options, mrSource, collect.onFileDensity)),
  );
  return perFile.flat();
}

async function collectRepoFile(
  path: string,
  onDensity?: (file: ScoredFile) => void,
): Promise<CollectedComment[]> {
  const language = languageForPath(path);
  if (language == null || language === "") return [];
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const source = await file.text();
  if (isGeneratedFile(path, source)) return [];
  const lines = source.split("\n");
  if (onDensity) {
    const added = new Set(lines.map((_, i) => i + 1));
    onDensity({ path, language, stats: await measureAddedLines(source, added, language) });
  }
  const comments = await extractComments(source, language);
  return comments
    .filter((comment) => !isExemptComment(comment))
    .map((comment) => toCollected(path, language, comment, lines));
}

/** Every comment in every tracked code file, narrowed by `--path` globs. The `--all` scope. */
export async function collectRepo(collect: CollectOptions = {}): Promise<CollectedComment[]> {
  const files = await listTrackedCodeFiles(collect);
  const perFile = await Promise.all(files.map((path) => collectRepoFile(path, collect.onFileDensity)));
  return perFile.flat();
}
