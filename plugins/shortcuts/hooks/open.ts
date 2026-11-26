#!/usr/bin/env bun

import { extname } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

export interface HookInput {
  tool_input?: unknown;
}

function hasCommand(value: unknown): value is { command: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    typeof value.command === "string"
  );
}

// Characters that end a simple command, splice another one into it, or hide a
// word from it. A command carrying any of them outside quotes is not a lone
// `open`, so the target this hook reads from it does not describe what the shell
// would actually run. `#` earns its place with the rest: the shell discards the
// comment it opens, so a trailing `#x.shortcut` would name a target `open` never
// receives.
const OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "{", "}", "`", "$", "#", "\n"]);

function readDoubleQuoted(command: string, start: number): { value: string; end: number } | null {
  let value = "";
  let j = start + 1;
  for (; j < command.length && command[j] !== '"'; j++) {
    const inner = command.charAt(j);
    if (inner === "$" || inner === "`") return null;
    if (inner === "\\") {
      const escaped = command[j + 1];
      if (escaped === undefined) return null;
      value += escaped;
      j++;
      continue;
    }
    value += inner;
  }
  if (j >= command.length) return null;
  return { value, end: j };
}

// Split a command into shell words, or return null when it is not a single
// simple command: an unbalanced quote, an operator, or any substitution
// (`$(...)`, `${x}`, backticks) whose value is unknowable here.
function tokenize(command: string): string[] | null {
  const tokens: string[] = [];
  let current: string | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command.charAt(i);

    if (/\s/.test(char)) {
      if (char === "\n") return null;
      if (current !== null) {
        tokens.push(current);
        current = null;
      }
      continue;
    }

    if (char === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return null;
      current = (current ?? "") + command.slice(i + 1, end);
      i = end;
      continue;
    }

    if (char === '"') {
      const quoted = readDoubleQuoted(command, i);
      if (!quoted) return null;
      current = (current ?? "") + quoted.value;
      i = quoted.end;
      continue;
    }

    if (char === "\\") {
      const escaped = command[i + 1];
      if (escaped === undefined || escaped === "\n") return null;
      current = (current ?? "") + escaped;
      i++;
      continue;
    }

    if (OPERATORS.has(char)) return null;
    current = (current ?? "") + char;
  }

  if (current !== null) tokens.push(current);
  return tokens;
}

// The `Bash(open:*)` rule only narrows which calls spawn this hook. It fails
// open on shell metacharacters, so `open notes.txt && echo done.shortcut`
// reaches here, and the extension of the last word would describe the `echo`
// rather than what `open` receives. Since this hook can hand back an allow,
// it decides on its own parse: a compound yields no target, and the call
// falls through to normal permissions.
function extractTarget(command: string): string | null {
  const tokens = tokenize(command) ?? [];
  if (tokens.length < 2 || tokens[0] !== "open") {
    return null;
  }
  return tokens.at(-1) ?? null;
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const command = hasCommand(input.tool_input) ? input.tool_input.command : undefined;
  const target = command === undefined ? null : extractTarget(command);

  if (target == null || target === "") {
    return null;
  }

  if (extname(target) === ".shortcut") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Opening a .shortcut file for import",
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Only .shortcut files can be opened. Use the appropriate tool for other file types.",
    },
  };
}

function deny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } satisfies SyncHookJSONOutput;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// `open` runs auto-approved and outside the sandbox, so this hook is the only
// thing holding it to .shortcut files: every failure denies rather than
// leaving the call ungated.
async function main(): Promise<void> {
  let input: HookInput;
  try {
    const parsed: unknown = JSON.parse(await Bun.stdin.text());
    if (!isObject(parsed)) throw new Error("hook input is not an object");
    input = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[shortcuts/open] Failed to parse hook input: ${message}`);
    deny(`shortcuts/open hook failed to parse input: ${message}`);
    return;
  }

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[shortcuts/open] Unexpected error: ${message}`);
    deny(`shortcuts/open hook encountered an error: ${message}`);
  });
}
