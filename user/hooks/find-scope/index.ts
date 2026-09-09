#!/usr/bin/env npx tsx

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";

const BashInput = z.looseObject({ command: z.string().optional().catch(undefined) });

// A heredoc body is file content: prose, prompts, and scripts where `find /` is
// data rather than an invocation.
const HEREDOC_BODY = /<<-?[ \t]*(['"]?)(\w+)\1[\s\S]*?^[ \t]*\2[ \t]*$/gm;
const QUOTED_SPAN = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const SUBSTITUTION = /\$\(|`/;

// `find` in command position. The leading alternation is what separates an
// invocation from `mdfind`, `findutils`, and a `find` that is just a word in a
// sentence: a command starts the string, follows a separator, or follows a
// wrapper that runs its argument.
const FIND_INVOCATION = /(?:^|[\n;&|(`]|\$\(|\b(?:sudo|command|xargs|time|nice)\s+)\s*find(?=\s)/g;

// Where a find invocation's own arguments stop. `-maxdepth` has to bind to the
// find being judged rather than to something further down the pipeline.
const COMMAND_END = /[\n;&|)`]/;

const LEADING_FLAG = /^-[HLPEsx]+$/;

// Roots that put the whole disk or the whole home directory in scope. A deeper
// path under any of them is a scoped search and stays allowed.
const BROAD_ROOT = /^(?:\/|~|\$HOME|\$\{HOME\}|(?:\/Users|\/home)\/[^/]+)$/;

const TOKEN = /(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S)+/g;

function stripHeredocs(command: string): string {
  return command.replace(HEREDOC_BODY, " ");
}

// Ranges the shell treats as literal text, where a `find` is an echo argument
// or a grep pattern. Double quotes keep expanding, so a span carrying a command
// substitution runs the `find` inside it and stays in scope.
function quotedRanges(command: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of command.matchAll(QUOTED_SPAN)) {
    const span = match[0];
    if (span.startsWith('"') && SUBSTITUTION.test(span)) continue;
    ranges.push([match.index, match.index + span.length]);
  }
  return ranges;
}

function isQuoted(index: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function unquote(token: string): string {
  return token.replaceAll(/['"]/g, "");
}

export function isBroadRoot(operand: string): boolean {
  const root = unquote(operand).replace(/(.)\/$/, "$1");
  return BROAD_ROOT.test(root);
}

// The first operand after any leading flags. `find -L / -name x` roots at `/`
// just as `find / -name x` does.
function firstOperand(args: string): string | null {
  for (const token of args.match(TOKEN) ?? []) {
    if (LEADING_FLAG.test(token)) continue;
    return token;
  }
  return null;
}

export function findsUnboundedFromBroadRoot(command: string): boolean {
  const stripped = stripHeredocs(command);
  const ranges = quotedRanges(stripped);

  for (const match of stripped.matchAll(FIND_INVOCATION)) {
    const start = match.index + match[0].length;
    if (isQuoted(match.index, ranges)) continue;

    const rest = stripped.slice(start);
    const end = rest.search(COMMAND_END);
    const args = end === -1 ? rest : rest.slice(0, end);

    const operand = firstOperand(args);
    if (operand == null || !isBroadRoot(operand)) continue;
    if (/(?:^|\s)-maxdepth(?=\s|$)/.test(args)) continue;

    return true;
  }

  return false;
}

export function formatDenyOutput(): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "`find` rooted at `/` or the home directory walks the whole disk. It runs for a minute or more, and often hits the Bash timeout before returning anything. Root it at a directory that can actually hold the target (`node_modules`, `~/.claude/plugins`, `$(go env GOMODCACHE)`), or use Glob with an explicit `path`. If the root has to stay broad, bound it with `-maxdepth`, or run `fd -HI <pattern> <root>`, which walks the same tree in seconds.",
    },
  };
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const command = BashInput.safeParse(input.tool_input).data?.command;
  if (command == null || command === "") {
    return null;
  }
  return findsUnboundedFromBroadRoot(command) ? formatDenyOutput() : null;
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = await readHookInput("find-scope");
  } catch (error) {
    console.error(
      `[find-scope] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await timeHook("find-scope", input, () => processInput(input));
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
