#!/usr/bin/env npx tsx

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";

const BashInput = z.looseObject({ command: z.string().optional().catch(undefined) });

const ALLOWED_SUBCOMMANDS = new Set(["list", "prune", "unlock"]);
const REPLACED_SUBCOMMANDS = new Set(["add", "remove"]);
const TMP_TARGET = /(^|\/)tmp\//;
const UNEXPANDED_VAR_TARGET = /^\$\{?\w+\}?\//;
const AGENT_WORKTREE_TARGET = /(^|\/)\.worktrees\//;

// A heredoc body is file content: prose, prompts, and scripts where the literal
// text `git worktree` is data rather than an invocation. Stripping runs before
// quotes because the quoted delimiter (`<<'BRIEF'`) anchors the body.
const HEREDOC_BODY = /<<-?[ \t]*(['"]?)(\w+)\1[\s\S]*?^[ \t]*\2[ \t]*$/gm;
const QUOTED_SPAN = /'[^']*'|"(?:[^"\\]|\\.)*"/g;

// A token is a run of non-space characters in which a quoted span counts as
// part of the token, so a target path containing spaces stays whole.
const TOKEN = /(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S)+/g;

function stripHeredocs(command: string): string {
  return command.replace(HEREDOC_BODY, " ");
}

function stripQuoted(command: string): string {
  return command.replace(QUOTED_SPAN, " ");
}

// Quote characters delimit the token, they are not part of the path.
function unquote(token: string): string {
  return token.replace(/['"]/g, "");
}

function tokensAfter(command: string, invocation: RegExp): string[] {
  const after = stripHeredocs(command).split(invocation)[1];
  if (after === undefined) return [];
  return (after.match(TOKEN) ?? []).map(unquote);
}

function isExemptTarget(token: string): boolean {
  return TMP_TARGET.test(token) || UNEXPANDED_VAR_TARGET.test(token);
}

export function isThrowawayAdd(command: string): boolean {
  return tokensAfter(command, /\bgit\s+worktree\s+add\b/).some(isExemptTarget);
}

export function isThrowawayRemove(command: string): boolean {
  return tokensAfter(command, /\bgit\s+worktree\s+remove\b/).some(
    (tok) => isExemptTarget(tok) || AGENT_WORKTREE_TARGET.test(tok),
  );
}

export function formatDenyOutput(subcommand: string): SyncHookJSONOutput {
  const base = `Use the worktrunk skill (/worktrunk) instead of \`git worktree ${subcommand}\`.`;
  const reason =
    subcommand === "add"
      ? `${base} For a throwaway verification checkout, add it under \`tmp/\`.`
      : subcommand === "remove"
        ? `${base} Throwaway worktrees under \`tmp/\` or \`.worktrees/\` may be removed directly.`
        : base;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function formatAskOutput(): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "Prefer the worktrunk skill (/worktrunk) over `git worktree`. Continue only if worktrunk does not support this operation.",
    },
  };
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const command = BashInput.safeParse(input.tool_input).data?.command;
  if (!command) {
    return null;
  }

  const match = stripQuoted(stripHeredocs(command)).match(/\bgit\s+worktree\s+(\w+)/);
  const subcommand = match?.[1];
  if (!subcommand) {
    return null;
  }
  if (ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return null;
  }
  if (subcommand === "add" && isThrowawayAdd(command)) {
    return null;
  }
  if (subcommand === "remove" && isThrowawayRemove(command)) {
    return null;
  }
  if (REPLACED_SUBCOMMANDS.has(subcommand)) {
    return formatDenyOutput(subcommand);
  }

  return formatAskOutput();
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = await readHookInput("worktree");
  } catch (error) {
    console.error(
      `[worktree] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await timeHook("worktree", input, () => processInput(input));
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
