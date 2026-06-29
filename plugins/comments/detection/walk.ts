import { $, Glob } from "bun";
import { languageForPath } from "./extract";

export interface WalkOptions {
  /** Glob patterns to intersect with the tracked-file list. Empty keeps all. */
  pathGlobs?: string[];
}

/**
 * A predicate matching a path against any of the `--path` globs. An empty or
 * absent glob list matches everything. Both scopes filter `--path` through this,
 * so a change to glob semantics applies to diff, repo, and MR alike.
 */
export function matchesPathGlobs(pathGlobs?: string[]): (path: string) => boolean {
  if (!pathGlobs || pathGlobs.length === 0) return () => true;
  const globs = pathGlobs.map((pattern) => new Glob(pattern));
  return (path) => globs.some((glob) => glob.match(path));
}

/**
 * Keep the paths that map to a known language, intersected with any `--path`
 * globs. Pure over its inputs so the language filter and glob intersection are
 * unit-testable without touching git.
 */
export function filterCodeFiles(files: string[], pathGlobs?: string[]): string[] {
  const matches = matchesPathGlobs(pathGlobs);
  return files.filter((path) => languageForPath(path) != null && matches(path));
}

/**
 * Every tracked code file in the repo, narrowed by `--path` globs. The `--all`
 * source: `git ls-files` is the only impurity, the filter is pure.
 */
export async function listTrackedCodeFiles(options: WalkOptions = {}): Promise<string[]> {
  const result = await $`git ls-files`.quiet().nothrow();
  const files = result.text().split("\n").filter(Boolean);
  return filterCodeFiles(files, options.pathGlobs);
}
