import { join } from "node:path";
import { $ } from "bun";

export interface ApplyOptions {
  branch: string;
}

/** True when `git status --porcelain` reports nothing, the apply precondition. */
export async function isCleanTree(): Promise<boolean> {
  const status = await $`git status --porcelain`.quiet().nothrow();
  return status.text().trim().length === 0;
}

/** The mode HEAD records for a tracked path (`100644`, `100755` for executables). */
async function headMode(path: string): Promise<string> {
  const entry = (await $`git ls-files -s -- ${path}`.quiet()).text().trim();
  const mode = entry.split(/\s+/)[0];
  if (mode == null || mode === "") throw new Error(`Path is not tracked at HEAD: ${path}`);
  return mode;
}

/**
 * Land the trims as a single commit on a fresh branch off HEAD, built entirely
 * with git plumbing so the working tree and current branch are never touched.
 * The edits stage into a scratch index seeded from HEAD, then a tree, a commit,
 * and finally the branch ref. The ref is the last step, so a failure anywhere
 * leaves nothing half-applied and a retry starts clean. Requires a clean working
 * tree: the edits are computed from working-tree files, so a clean tree
 * guarantees they are HEAD content minus the trims.
 */
export async function applyToBranch(
  editsByPath: Map<string, string>,
  options: ApplyOptions,
): Promise<void> {
  if (!(await isCleanTree())) {
    throw new Error("Working tree is not clean. Commit or stash before applying.");
  }

  const gitDir = (await $`git rev-parse --git-dir`.quiet()).text().trim();
  const indexFile = join(gitDir, `comments-apply-index-${options.branch.replace(/[^\w.-]/g, "_")}`);
  const env = { GIT_INDEX_FILE: indexFile };

  try {
    await $`git read-tree HEAD`.env(env).quiet();
    for (const [path, content] of editsByPath) {
      const mode = await headMode(path);
      const blob = (await $`git hash-object -w --stdin < ${Buffer.from(content)}`.quiet())
        .text()
        .trim();
      await $`git update-index --cacheinfo ${`${mode},${blob},${path}`}`.env(env).quiet();
    }
    const tree = (await $`git write-tree`.env(env).quiet()).text().trim();
    const commit = (
      await $`git commit-tree ${tree} -p HEAD -m ${"comments: trim AI-slop comments"}`.quiet()
    )
      .text()
      .trim();
    const created = await $`git branch ${options.branch} ${commit}`.nothrow().quiet();
    if (created.exitCode !== 0) {
      throw new Error(
        `Could not create branch ${options.branch}: ${created.stderr.toString().trim()}`,
      );
    }
  } finally {
    await Bun.file(indexFile)
      .delete()
      .catch(() => {});
  }
}
