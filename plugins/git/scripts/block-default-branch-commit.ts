#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { getDefaultBranch } from "./default-branch";

type BashInput = { command?: string };

// Flags git accepts between the executable and its subcommand. Enumerated
// rather than matched as a generic `-\S+` so that a value which happens to be
// the word `commit` (`git log --grep commit`) cannot be read as the subcommand.
const VALUE_FLAG = String.raw`(?:-[cC]|--(?:git-dir|work-tree|namespace|exec-path|config-env))(?:=\S+|\s+\S+)`;
const BOOLEAN_FLAG =
  "--(?:no-pager|paginate|bare|literal-pathspecs|no-replace-objects|no-optional-locks)";
const GIT_COMMIT_PATTERN = new RegExp(
  String.raw`\bgit\s+(?:(?:${VALUE_FLAG}|${BOOLEAN_FLAG})\s+)*commit(?![\w-])`,
);

// Quoted spans carry commit messages, grep patterns, and here-doc prose, where
// the literal text `git commit` is data rather than an invocation.
function stripQuoted(command: string): string {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, " ");
}

export function invokesGitCommit(command: string): boolean {
  return GIT_COMMIT_PATTERN.test(stripQuoted(command));
}

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
  input: PreToolUseHookInput,
  cwd?: string,
): Promise<SyncHookJSONOutput | null> {
  // The `Bash(git commit:*)` condition only narrows which calls spawn this hook.
  // It fails open on shell metacharacters, so the deny decision rests on the
  // command this hook reads for itself.
  const { command } = input.tool_input as BashInput;
  if (!command || !invokesGitCommit(command)) {
    return null;
  }

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
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[git/block-default-branch-commit] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
