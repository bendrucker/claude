#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { BashInput, PreToolUse } from "./hook-input";

/**
 * `git push -u` rewrites `branch.<name>.*` under the config lock even when the
 * values already match, and the sandbox denies every `.git/config` write, so
 * from a linked worktree the push lands and the upstream write fails. Hooks run
 * outside the sandbox, so this one records the tracking and drops the flag.
 */

const UPSTREAM_FLAGS = new Set(["-u", "--set-upstream"]);

/** Valueless push flags that leave the refspec reading unchanged. */
const PASSTHROUGH_FLAGS = new Set([
  "-f",
  "--force",
  "--force-with-lease",
  "--force-if-includes",
  "--no-verify",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--progress",
  "--atomic",
]);

/** `git` options before `push` that keep it in the hook's repository. */
const GLOBAL_OPTIONS = new Set(["-c", "--no-pager"]);

const SEGMENT_SEPARATOR = /&&|\|\||[;|\n]/g;
const QUOTED_SPAN = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const REDIRECTION = /^(?:\d*[<>]|&>)/;

export interface UpstreamPush {
  /** Offsets of the `-u` token in the original command. */
  flag: { start: number; end: number };
  remote: string;
  /** The refspec's source, `HEAD` or a branch name. */
  source: string;
  /** The remote branch the push lands on, when the refspec names one. */
  destination: string | null;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

// Quoted spans become underscores so their spaces don't split tokens and a
// quoted operand never reads as a plain word. Offsets stay aligned.
function tokens(command: string, from: number, to: number): Token[] {
  const masked = command.slice(from, to).replace(QUOTED_SPAN, (span) => "_".repeat(span.length));
  return [...masked.matchAll(/\S+/g)].map((m) => ({
    text: command.slice(from + m.index, from + m.index + m[0].length),
    start: from + m.index,
    end: from + m.index + m[0].length,
  }));
}

function segments(command: string): [number, number][] {
  const bounds: [number, number][] = [];
  let start = 0;
  for (const match of command.matchAll(SEGMENT_SEPARATOR)) {
    bounds.push([start, match.index]);
    start = match.index + match[0].length;
  }
  bounds.push([start, command.length]);
  return bounds;
}

function readPush(args: Token[]): UpstreamPush | null {
  let flag: Token | null = null;
  const positionals: string[] = [];
  for (const arg of args) {
    if (REDIRECTION.test(arg.text)) break;
    if (UPSTREAM_FLAGS.has(arg.text)) flag = arg;
    else if (arg.text.startsWith("--force-with-lease=")) continue;
    else if (PASSTHROUGH_FLAGS.has(arg.text)) continue;
    else if (arg.text.startsWith("-")) return null;
    else if (/^[\w./:+@-]+$/.test(arg.text)) positionals.push(arg.text);
    else return null;
  }
  if (flag == null || positionals.length !== 2) return null;

  const [remote = "", refspec = ""] = positionals;
  const [source = "", destination] = refspec.replace(/^\+/, "").split(":", 2);
  return {
    flag: { start: flag.start, end: flag.end },
    remote,
    source,
    destination: destination == null ? null : destination.replace(/^refs\/heads\//, ""),
  };
}

/**
 * Finds the first `git push -u <remote> <refspec>` in a shell line. Returns
 * null for any shape it can't read with certainty, including a `cd` or `-C`
 * that would move the push out of the hook's working directory.
 */
export function parseUpstreamPush(command: string): UpstreamPush | null {
  for (const [from, to] of segments(command)) {
    const words = tokens(command, from, to);
    if (words[0]?.text === "cd") return null;
    if (words[0]?.text !== "git") continue;

    const push = words.findIndex((w) => w.text === "push");
    if (push === -1) continue;
    const globals = words.slice(1, push).filter((w) => w.text.startsWith("-"));
    if (globals.some((w) => !GLOBAL_OPTIONS.has(w.text))) return null;
    return readPush(words.slice(push + 1));
  }
  return null;
}

export function dropFlag(command: string, { start, end }: UpstreamPush["flag"]): string {
  return command.slice(0, start) + command.slice(end).replace(/^\s+/, "");
}

export interface Git {
  currentBranch(): Promise<string>;
  remotes(): Promise<string[]>;
  isBranchName(name: string): Promise<boolean>;
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<boolean>;
}

export function gitIn(cwd: string): Git {
  return {
    currentBranch: async () =>
      (await $`git branch --show-current`.cwd(cwd).quiet().nothrow()).text().trim(),
    remotes: async () =>
      (await $`git remote`.cwd(cwd).quiet().nothrow()).text().split("\n").filter(Boolean),
    isBranchName: async (name) =>
      (await $`git check-ref-format ${`refs/heads/${name}`}`.cwd(cwd).quiet().nothrow())
        .exitCode === 0,
    get: async (key) => (await $`git config --get ${key}`.cwd(cwd).quiet().nothrow()).text().trim(),
    set: async (key, value) =>
      (await $`git config ${key} ${value}`.cwd(cwd).quiet().nothrow()).exitCode === 0,
  };
}

export async function processInput(
  input: PreToolUseHookInput,
  git: Git = gitIn(input.cwd),
): Promise<SyncHookJSONOutput | null> {
  const toolInput = BashInput.safeParse(input.tool_input).data;
  const command = toolInput?.command;
  if (command == null || command === "") return null;

  const push = parseUpstreamPush(command);
  if (push == null) return null;

  const branch = await git.currentBranch();
  if (branch === "") return null;
  if (push.source !== "HEAD" && push.source !== branch) return null;
  const destination = push.destination ?? branch;
  if (!(await git.isBranchName(destination))) return null;
  if (!(await git.remotes()).includes(push.remote)) return null;

  const remoteKey = `branch.${branch}.remote`;
  const mergeKey = `branch.${branch}.merge`;
  const merge = `refs/heads/${destination}`;
  const [currentRemote, currentMerge] = await Promise.all([git.get(remoteKey), git.get(mergeKey)]);
  // Sequential, since each write takes the same config lock.
  if (currentRemote !== push.remote && !(await git.set(remoteKey, push.remote))) return null;
  if (currentMerge !== merge && !(await git.set(mergeKey, merge))) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, command: dropFlag(command, push.flag) },
      additionalContext: `The git plugin recorded ${branch}'s upstream as ${push.remote}/${destination} and removed -u from the push, because the sandbox denies the .git/config write -u makes.`,
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = PreToolUse.parse(JSON.parse(await Bun.stdin.text()));
  } catch {
    // Malformed hook input must not crash the hook. Skip this invocation.
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
