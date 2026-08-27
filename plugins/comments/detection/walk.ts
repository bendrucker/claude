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

/** True when `path` sits under one of the vendored roots. */
export function isVendoredPath(path: string, vendoredRoots: string[]): boolean {
  return vendoredRoots.some((root) => path.startsWith(`${root}/`));
}

/** Drop files under a vendored root. Pure over its inputs. */
export function excludeVendored(files: string[], vendoredRoots: string[]): string[] {
  if (vendoredRoots.length === 0) return files;
  return files.filter((path) => !isVendoredPath(path, vendoredRoots));
}

/**
 * Directories that carry their own `LICENSE` distinct from the repo root, taken
 * as vendored third-party trees the audit must not touch. Editing them diverges
 * from upstream and is not ours to do. A root-level license is the repo's own and
 * is ignored. `git ls-files` is the only impurity.
 */
export async function listVendoredRoots(): Promise<string[]> {
  const result = await $`git ls-files`.quiet().nothrow();
  const roots = new Set<string>();
  for (const file of result.text().split("\n").filter(Boolean)) {
    const slash = file.lastIndexOf("/");
    if (slash === -1) continue;
    if (/^LICENSE(\.(txt|md))?$/i.test(file.slice(slash + 1))) roots.add(file.slice(0, slash));
  }
  return [...roots];
}

/**
 * Every tracked code file in the repo, narrowed by `--path` globs and stripped of
 * vendored trees. `git ls-files` is the only impurity, the filters are pure.
 */
export async function listTrackedCodeFiles(options: WalkOptions = {}): Promise<string[]> {
  const [result, vendoredRoots] = await Promise.all([
    $`git ls-files`.quiet().nothrow(),
    listVendoredRoots(),
  ]);
  const files = result.text().split("\n").filter(Boolean);
  return excludeVendored(filterCodeFiles(files, options.pathGlobs), vendoredRoots);
}
