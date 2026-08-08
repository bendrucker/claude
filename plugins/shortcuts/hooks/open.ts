#!/usr/bin/env bun

import { extname } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

type BashInput = { command: string };

// Characters that end a simple command, splice another one into it, or hide a
// word from it. A command carrying any of them outside quotes is not a lone
// `open`, so the target this hook reads from it does not describe what the shell
// would actually run. `#` earns its place with the rest: the shell discards the
// comment it opens, so a trailing `#x.shortcut` would name a target `open` never
// receives.
const OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "{", "}", "`", "$", "#", "\n"]);

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
      let value = "";
      let j = i + 1;
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
      current = (current ?? "") + value;
      i = j;
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
// rather than what `open` receives. Since this hook can hand back a sandbox
// bypass, it decides on its own parse: a compound yields no target, and the call
// falls through to normal permissions.
function extractTarget(command: string): string | null {
  const tokens = tokenize(command) ?? [];
  if (tokens.length < 2 || tokens[0] !== "open") {
    return null;
  }
  return tokens.at(-1) ?? null;
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { command } = input.tool_input as BashInput;
  const target = extractTarget(command);

  if (!target) {
    return null;
  }

  if (extname(target) === ".shortcut") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Opening a .shortcut file for import",
        updatedInput: { dangerouslyDisableSandbox: true },
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

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[shortcuts/open] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
