import { mkdirSync } from "node:fs";
import { $ } from "bun";

/**
 * Copies repo-relative paths into a directory, keeping their layout, as they stand at a git
 * ref or in the working tree. The working-tree copy skips node_modules and results, since the
 * eval runner rejects the symlinks a workspace install leaves.
 */
export async function stage(
  repo: string,
  ref: string | undefined,
  paths: string[],
  into: string,
): Promise<void> {
  mkdirSync(into, { recursive: true });
  if (paths.length === 0) return;
  await (
    ref === undefined
      ? $`cd ${repo} && rsync -aR --exclude node_modules --exclude results ${paths} ${into}/`
      : $`git -C ${repo} archive --format=tar ${ref} -- ${paths} | tar -xf - -C ${into}`
  ).quiet();
}
