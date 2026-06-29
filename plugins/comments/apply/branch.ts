import { $ } from "bun";

export interface ApplyOptions {
  branch: string;
}

/** True when `git status --porcelain` reports nothing, the apply precondition. */
export async function isCleanTree(): Promise<boolean> {
  const status = await $`git status --porcelain`.quiet().nothrow();
  return status.text().trim().length === 0;
}

/**
 * Land the trims as a single commit on a fresh branch off HEAD, so the review
 * surface is a normal `git diff`. Requires a clean working tree: the branch is
 * the only mutation, and a dirty tree would carry unrelated changes into it.
 */
export async function applyToBranch(
  editsByPath: Map<string, string>,
  options: ApplyOptions,
): Promise<void> {
  if (!(await isCleanTree())) {
    throw new Error("Working tree is not clean. Commit or stash before applying.");
  }
  await $`git switch -c ${options.branch}`.quiet();
  await Promise.all([...editsByPath].map(([path, content]) => Bun.write(path, content)));
  await $`git add ${[...editsByPath.keys()]}`.quiet();
  await $`git commit -m ${"comments: trim AI-slop comments"}`.quiet();
}
