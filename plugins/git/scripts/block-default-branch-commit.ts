#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
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

  // One rev-parse yields both the repo root (cache key) and current branch.
  // A non-zero exit means we're outside a repo; "HEAD" means detached.
  const rev = await $`git rev-parse --show-toplevel --abbrev-ref HEAD`.cwd(dir).quiet().nothrow();
  if (rev.exitCode !== 0) {
    return null;
  }
  const [repoRoot, currentBranch] = rev.text().trim().split("\n");
  if (!repoRoot || !currentBranch || currentBranch === "HEAD") {
    return null;
  }

  const defaultBranch = await getDefaultBranch(dir, repoRoot);
  if (!defaultBranch) {
    return null;
  }

  if (currentBranch === defaultBranch) {
    return formatDenyOutput(defaultBranch);
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[git/block-default-branch-commit] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
