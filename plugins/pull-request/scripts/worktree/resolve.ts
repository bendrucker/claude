#!/usr/bin/env bun
// Resolve branch to worktree path
// Args: <branch>

import { $ } from "bun";

export async function resolveWorktree(branch: string): Promise<string | null> {
  if (!branch) return null;

  const result = await $`git worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    return null;
  }

  const output = result.text();
  const targetRef = `refs/heads/${branch}`;
  let currentPath: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice(9);
    } else if (line.startsWith("branch ") && line.slice(7) === targetRef) {
      return currentPath;
    }
  }

  return null;
}

if (import.meta.main) {
  const branch = process.argv[2];
  if (!branch) {
    process.exit(0);
  }

  const path = await resolveWorktree(branch);
  if (path) {
    console.log(path);
  }
}
