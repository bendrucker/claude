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
