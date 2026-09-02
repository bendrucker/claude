import { $ } from "bun";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  addedLines,
  isGeneratedPath,
  measureAddedLines,
  type ScoredFile,
  sessionScore,
  type SessionScore,
} from "./density";
import { isGeneratedFile } from "./collect";
import { languageForPath } from "./extract";

const MAX_FILE_CHARS = 2_000_000;

/** Directories holding throwaway output, scored in no repo. */
const SCRATCH = /(^|\/)(tmp|scratchpad|tasks)\//;

/** Refs to take a merge base against when the repo has no `origin/HEAD`, in preference order. */
const DEFAULT_REFS = [
  "refs/remotes/origin/main",
  "refs/remotes/origin/master",
  "refs/heads/main",
  "refs/heads/master",
];

async function repoRoot(cwd: string): Promise<string | null> {
  const result = await $`git rev-parse --show-toplevel`.cwd(cwd).quiet().nothrow();
  const root = result.text().trim();
  return result.exitCode === 0 && root !== "" ? root : null;
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

async function defaultRef(root: string): Promise<string | null> {
  const head = await $`git rev-parse --abbrev-ref origin/HEAD`.cwd(root).quiet().nothrow();
  const ref = head.text().trim();
  if (head.exitCode === 0 && ref !== "" && !ref.endsWith("HEAD")) return ref;
  const format = "%(refname)";
  const refs = await $`git for-each-ref --format=${format} ${DEFAULT_REFS}`
    .cwd(root)
    .quiet()
    .nothrow();
  if (refs.exitCode !== 0) return null;
  const present = new Set(lines(refs.text()));
  return DEFAULT_REFS.find((candidate) => present.has(candidate)) ?? null;
}

/**
 * The commit the current work sits on top of: the merge base with the default
 * branch, so committed and uncommitted work both count as introduced. Null on
 * an unborn branch, where every file is new. With no default branch to compare
 * against, HEAD stands in and only uncommitted work counts: a score that misses
 * committed comments beats one that charges a whole repo for them.
 */
async function diffBase(root: string): Promise<string | null> {
  const head = await $`git rev-parse --verify HEAD`.cwd(root).quiet().nothrow();
  if (head.exitCode !== 0) return null;
  const ref = await defaultRef(root);
  if (ref == null) return "HEAD";
  const base = await $`git merge-base HEAD ${ref}`.cwd(root).quiet().nothrow();
  const sha = base.text().trim();
  return base.exitCode === 0 && sha !== "" ? sha : "HEAD";
}

/** A changed file and the path its base version sits at, which a rename moves. */
interface ChangedFile {
  path: string;
  source: string;
}

/**
 * Files the branch changed against `base`, plus untracked ones. Renames carry
 * their old path, so moving a file introduces only what the move changed.
 */
async function changedFiles(root: string, base: string | null): Promise<ChangedFile[]> {
  const files = new Map<string, ChangedFile>();
  if (base != null) {
    const diff = await $`git diff --name-status -M --diff-filter=d ${base} --`
      .cwd(root)
      .quiet()
      .nothrow();
    if (diff.exitCode === 0) {
      for (const line of lines(diff.text())) {
        const [status = "", first, second] = line.split("\t");
        if (first == null) continue;
        const moved = status.startsWith("R");
        const path = moved ? second : first;
        if (path == null) continue;
        files.set(path, { path, source: first });
      }
    }
  }
  // An unborn branch has no base to diff against, so its staged files are new too.
  const listed =
    base == null
      ? $`git ls-files --cached --others --exclude-standard`
      : $`git ls-files --others --exclude-standard`;
  const others = await listed.cwd(root).quiet().nothrow();
  if (others.exitCode === 0) {
    for (const path of lines(others.text())) files.set(path, { path, source: path });
  }
  return [...files.values()];
}

async function contentAt(root: string, base: string, path: string): Promise<string> {
  const result = await $`git show ${`${base}:${path}`}`.cwd(root).quiet().nothrow();
  return result.exitCode === 0 ? result.text() : "";
}

/** Resolve symlinked ancestors so paths from two sources compare equal. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Measure one file's current content against the version at `base`. Lines the
 * base already carried do not count, so a file scores what its introduced
 * comments weigh now.
 */
async function scoreFile(
  root: string,
  base: string | null,
  { path, source }: ChangedFile,
): Promise<ScoredFile | null> {
  const language = languageForPath(path);
  if (language == null || language === "") return null;
  if (SCRATCH.test(path) || isGeneratedPath(path)) return null;
  const blob = Bun.file(join(root, path));
  if (!(await blob.exists())) return null;
  if (blob.size === 0 || blob.size > MAX_FILE_CHARS) return null;
  const current = await blob.text();
  if (isGeneratedFile(path, current)) return null;
  const previous = base == null ? "" : await contentAt(root, base, source);
  const { fragment, added } = addedLines(previous, current);
  if (added.size === 0) return null;
  return { path, language, stats: await measureAddedLines(fragment, added, language) };
}

export interface TreeOptions {
  /** A directory inside the repo to score. */
  cwd: string;
  /** Absolute paths to narrow to. Every changed file when omitted. */
  paths?: readonly string[];
}

/**
 * Score the comments a branch introduced, measured from the working tree.
 * Trimming a comment lowers the score and a tree matching its base scores zero.
 * Outside a git repo nothing is scored.
 */
export async function scoreTree(
  options: TreeOptions,
): Promise<{ files: ScoredFile[]; session: SessionScore }> {
  const root = await repoRoot(options.cwd);
  if (root == null) return { files: [], session: sessionScore([]) };
  const wanted = options.paths == null ? null : new Set(options.paths.map(realPath));
  const base = await diffBase(root);
  const files = (await changedFiles(root, base)).filter(
    (file) => wanted == null || wanted.has(realPath(join(root, file.path))),
  );
  const scored = await Promise.all(files.map((file) => scoreFile(root, base, file)));
  const measured = scored.filter((file) => file != null);
  return { files: measured, session: sessionScore(measured) };
}
