#!/usr/bin/env bun

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";
import { readTranscriptTail } from "../../scripts/transcript";

// Claude Code refuses an EnterWorktree it can already see will fail: a target
// outside the session's repository, the current directory itself, or, once
// the session has switched into a worktree, anything outside the repository's
// `.claude/worktrees/`. Worktrunk never places worktrees there.

const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

const Envelope = z.looseObject({
  cwd: z.string().optional().catch(undefined),
  agent_id: z.string().optional().catch(undefined),
  transcript_path: z.string().optional().catch(undefined),
  tool_input: z.looseObject({ path: z.string().optional().catch(undefined) }).catch({}),
});
type Envelope = z.infer<typeof Envelope>;

const WorktreeState = z.looseObject({
  type: z.literal("worktree-state"),
  worktreeSession: z.looseObject({ worktreePath: z.string() }).nullable(),
});

function realpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return null;
    }
    throw error;
  }
}

function gitCommonDir(dir: string): string | null {
  const result = Bun.spawnSync(
    ["git", "-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { stdout: "pipe", stderr: "ignore" },
  );
  if (result.exitCode !== 0) return null;
  return realpath(result.stdout.toString().trim());
}

function isUnder(path: string, dir: string): boolean {
  return path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

// The newest `worktree-state` record is the harness's own record of whether
// this session has switched into a worktree. Null means it has not, or has
// exited.
export async function worktreeSessionActive(transcriptPath: string): Promise<boolean | undefined> {
  const entries = await readTranscriptTail(transcriptPath, TRANSCRIPT_TAIL_BYTES);
  for (let i = entries.length - 1; i >= 0; i--) {
    const state = WorktreeState.safeParse(entries[i]);
    if (state.success) return state.data.worktreeSession !== null;
  }
  return undefined;
}

function deny(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function sameDirectoryReason(target: string): string {
  return `\`${target}\` is already the working directory. Keep working here.`;
}

export function crossRepoReason(target: string): string {
  return [
    `\`${target}\` belongs to a different repository than this session, and EnterWorktree only enters worktrees of the session's own repository.`,
    "For work that becomes its own pull request, dispatch a sibling agent into it through the `herdr:herdr` skill.",
    `For read-only work, spawn an \`Agent\` with \`cwd\` set to \`${target}\`.`,
  ].join(" ");
}

export function unmanagedReason(target: string, managedDir: string): string {
  return [
    `This session has already switched into a worktree, and from here EnterWorktree only enters worktrees under \`${managedDir}/\`.`,
    `Work in \`${target}\` from the current session with \`git -C ${target}\` and absolute paths.`,
  ].join(" ");
}

export async function processInput(input: Envelope): Promise<SyncHookJSONOutput | null> {
  const rawTarget = input.tool_input.path;
  const cwd = input.cwd;
  if (rawTarget == null || rawTarget === "" || cwd == null || cwd === "") return null;

  const expanded = rawTarget.startsWith("~/") ? join(homedir(), rawTarget.slice(2)) : rawTarget;
  const target = realpath(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
  const current = realpath(cwd);
  if (target == null || current == null) return null;

  if (target === current) return deny(sameDirectoryReason(target));

  const targetCommon = gitCommonDir(target);
  const currentCommon = gitCommonDir(current);
  if (targetCommon == null || currentCommon == null) return null;
  if (targetCommon !== currentCommon) return deny(crossRepoReason(target));

  // Subagents keep their own worktree state, which the session transcript does
  // not record.
  if (input.agent_id != null || input.transcript_path == null) return null;
  if (basename(currentCommon) !== ".git") return null;
  const managedDir = join(dirname(currentCommon), ".claude", "worktrees");
  if (isUnder(target, realpath(managedDir) ?? managedDir)) return null;
  if ((await worktreeSessionActive(input.transcript_path)) !== true) return null;

  return deny(unmanagedReason(target, managedDir));
}

async function main(): Promise<void> {
  let raw: HookInput;
  let input: Envelope;
  try {
    raw = await readHookInput("enter-worktree");
    input = Envelope.parse(raw);
  } catch (error) {
    console.error(
      `[enter-worktree] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await timeHook("enter-worktree", raw, () => processInput(input));
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
