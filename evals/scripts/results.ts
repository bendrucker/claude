import { join, resolve } from "node:path";

/** Where `evals/native/run.ts` writes each suite's runs, relative to the repo root. */
export const RESULT_GLOBS = [
  "plugins/*/evals/*/results/*/aggregate-result.json",
  "evals/user/*/results/*/aggregate-result.json",
];

export function repoRoot(): string {
  return join(import.meta.dirname, "..", "..");
}

/**
 * Every native run's `aggregate-result.json` under a repo root, sorted. A `-regraded`
 * directory from `regrade.ts` carries its source run's cost, so it is left out.
 */
export function resultFiles(root: string): string[] {
  const base = resolve(root);
  const files: string[] = [];
  for (const pattern of RESULT_GLOBS) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: base, onlyFiles: true })) {
      if (!path.endsWith("-regraded/aggregate-result.json")) files.push(join(base, path));
    }
  }
  return files.toSorted();
}
