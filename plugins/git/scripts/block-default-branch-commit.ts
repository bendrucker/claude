#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { runHook } from "@bendrucker/claude-hook";
import { $ } from "bun";
import { getDefaultBranch } from "./default-branch";

export function formatDenyOutput(branch: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Cannot commit directly to ${branch}. Create a topic branch first with: git checkout -b <branch-name>`,
    },
  };
}

export async function processInput(
  _input: PreToolUseHookInput,
  cwd?: string,
): Promise<SyncHookJSONOutput | null> {
  const dir = cwd ?? process.cwd();

  const gitDir = await $`git rev-parse --git-dir`.cwd(dir).quiet().nothrow();
  if (gitDir.exitCode !== 0) {
    return null;
  }

  const branch = await $`git symbolic-ref --short HEAD`.cwd(dir).quiet().nothrow();
  if (branch.exitCode !== 0) {
    return null;
  }
  const currentBranch = branch.text().trim();

  const defaultBranch = await getDefaultBranch(dir);
  if (!defaultBranch) {
    return null;
  }

  if (currentBranch === defaultBranch) {
    return formatDenyOutput(defaultBranch);
  }

  return null;
}

if (import.meta.main) {
  runHook(processInput, "git/block-default-branch-commit");
}
