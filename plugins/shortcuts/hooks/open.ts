#!/usr/bin/env bun

import { extname } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

type BashInput = { command: string };

function unquote(arg: string): string {
  const match = arg.match(/^(["'])(.+)\1$/);
  return match ? match[2]! : arg;
}

function extractTarget(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed.startsWith("open ")) {
    return null;
  }

  const args = trimmed.slice("open ".length).trim();

  // Match the last quoted or unquoted argument, skipping flags
  const tokens = args.match(/"[^"]+"|'[^']+'|\S+/g);
  if (!tokens) {
    return null;
  }

  const lastToken = tokens[tokens.length - 1]!;
  return unquote(lastToken);
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
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
