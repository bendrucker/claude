import { basename } from "node:path";

export type WtWorktree = { branch: string | null; path: string };

// `claude --worktree <paneName>` names the branch either `<paneName>` or
// `worktree-<paneName>` (claude's default prefix). Match those exact forms on the
// branch, or the worktree directory's basename as a fallback. Exact-match (not
// substring) so paneName `review-o-r-1` never matches PR #12's `review-o-r-12`.
function carriesPaneName(value: string | null, paneName: string): boolean {
  return value === paneName || value === `worktree-${paneName}`;
}

// Identifying by paneName (rather than a hardcoded path) keeps this independent
// of the Worktrunk path template (`.worktrees/<branch>` vs `.claude/worktrees/`).
export function findReviewWorktree(
  worktrees: WtWorktree[],
  paneName: string,
): WtWorktree | undefined {
  return worktrees.find(
    (wt) => carriesPaneName(wt.branch, paneName) || carriesPaneName(basename(wt.path), paneName),
  );
}

export type WorktreeRemoval =
  | { paneName: string; status: "removed"; branch: string }
  | { paneName: string; status: "absent" }
  | { paneName: string; status: "failed"; error: string };

function runWt(repoPath: string, args: string[]) {
  return Bun.spawnSync(["wt", ...args], { cwd: repoPath, stdout: "pipe", stderr: "pipe" });
}

// Reclaim a completed review's worktree through Worktrunk: `wt remove --force`
// removes the worktree (including untracked files) and its pre-remove hooks run,
// and the branch is deleted when it has no unmerged commits. Going through `wt`
// rather than `git worktree` respects the user's Worktrunk-first setup.
export function removeWorktree(repoPath: string, paneName: string): WorktreeRemoval {
  const list = runWt(repoPath, ["list", "--format=json"]);
  if (list.exitCode !== 0) {
    return { paneName, status: "failed", error: list.stderr.toString().trim() };
  }
  let worktrees: WtWorktree[];
  try {
    worktrees = JSON.parse(list.stdout.toString()) as WtWorktree[];
  } catch (cause) {
    return {
      paneName,
      status: "failed",
      error: `Could not parse wt list output: ${String(cause)}`,
    };
  }
  const entry = findReviewWorktree(worktrees, paneName);
  if (!entry) {
    return { paneName, status: "absent" };
  }
  if (!entry.branch) {
    return { paneName, status: "failed", error: `worktree ${entry.path} has no branch to remove` };
  }
  const removed = runWt(repoPath, ["remove", entry.branch, "--force"]);
  if (removed.exitCode !== 0) {
    return { paneName, status: "failed", error: removed.stderr.toString().trim() };
  }
  return { paneName, status: "removed", branch: entry.branch };
}
