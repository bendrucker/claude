#!/usr/bin/env bun
// Gather git context for pull request skills
// Args: [branch] — resolves worktree path if provided
// Outputs labeled sections: Branch, Status, Log, Diff

import { $ } from "bun";
import { resolveWorktree } from "./worktree/resolve";

export async function gitContext(cwd?: string): Promise<string> {
  const shell = cwd ? $.cwd(cwd) : $;

  const branch = (await shell`git branch --show-current`.text()).trim();
  const status = (await shell`git status --short`.text()).trim();
  const log = (await shell`git log --oneline -20`.text()).trim();

  let diff: string;
  try {
    diff = (await shell`git diff HEAD`.text()).trim();
  } catch {
    diff = (await shell`git diff --cached`.text()).trim();
  }

  const sections = [`Branch: ${branch}`];

  if (status) {
    sections.push(`Status:\n${status}`);
  }

  if (log) {
    sections.push(`Log:\n${log}`);
  }

  if (diff) {
    sections.push(`Diff:\n${diff}`);
  }

  return sections.join("\n\n");
}

if (import.meta.main) {
  const branch = process.argv[2];
  const worktreePath = branch ? await resolveWorktree(branch) : null;
  console.log(await gitContext(worktreePath ?? undefined));
}
