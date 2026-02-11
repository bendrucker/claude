#!/usr/bin/env bun
// Fetch PR/MR diff for the current branch
// Args: [branch]
// Detects provider and runs gh pr diff or glab mr diff

import { $ } from "bun";
import { detectProvider } from "./detect-provider";
import { resolveWorktree } from "./worktree/resolve";

const [branch = ""] = process.argv.slice(2);
const cwd = (await resolveWorktree(branch)) || undefined;
const provider = detectProvider(cwd);
const shell = cwd ? $.cwd(cwd) : $;

if (provider === "github") {
  const result = await shell`gh pr diff`.nothrow().quiet();
  process.stdout.write(result.stdout);
} else if (provider === "gitlab") {
  const result = await shell`glab mr diff`.nothrow().quiet();
  process.stdout.write(result.stdout);
}
