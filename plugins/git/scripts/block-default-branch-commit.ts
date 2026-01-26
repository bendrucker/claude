#!/usr/bin/env bun

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type BashInput = {
  command?: string;
};

function isInGitRepo(): boolean {
  try {
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(): string | null {
  try {
    return execSync("git symbolic-ref --short HEAD", { stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}

export function getDefaultBranch(): string | null {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", { stdio: "pipe" }).toString().trim();
    const safePath = repoRoot.replace(/\//g, "_");
    const tmpDir = process.env.TMPDIR || os.tmpdir();
    const cacheFile = path.join(tmpDir, `claude-default-branch${safePath}`);

    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, "utf-8").trim();
    }

    let defaultBranch: string | null = null;

    try {
      const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
        stdio: "pipe",
      })
        .toString()
        .trim();
      defaultBranch = ref.replace(/^refs\/remotes\/origin\//, "");
    } catch {
      try {
        defaultBranch = execSync(
          "gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'",
          { stdio: "pipe" },
        )
          .toString()
          .trim();
      } catch {
        // Neither method worked
      }
    }

    if (defaultBranch) {
      fs.writeFileSync(cacheFile, defaultBranch);
    }

    return defaultBranch || null;
  } catch {
    return null;
  }
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

export function processInput(_input: PreToolUseHookInput): SyncHookJSONOutput | null {
  if (!isInGitRepo()) {
    return null;
  }

  const currentBranch = getCurrentBranch();
  if (!currentBranch) {
    return null;
  }

  const defaultBranch = getDefaultBranch();
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

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
