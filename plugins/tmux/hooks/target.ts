#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const targetableCommands = new Set([
  "split-window",
  "splitw",
  "send-keys",
  "send",
  "capture-pane",
  "capturep",
  "select-pane",
  "selectp",
  "resize-pane",
  "resizep",
  "kill-pane",
  "killp",
  "select-layout",
  "selectl",
  "rename-window",
  "renamew",
  "swap-pane",
  "swapp",
  "swap-window",
  "swapw",
  "move-pane",
  "movep",
  "move-window",
  "movew",
]);

export function parseTmuxCommand(command: string): { subcommand: string; rest: string } | null {
  const match = command.match(/^tmux\s+(\S+)(.*)/);
  if (!match?.[1]) return null;
  return { subcommand: match[1], rest: match[2] ?? "" };
}

export function hasExistingTarget(rest: string): boolean {
  return /(?:^|\s)-t(?:[^a-zA-Z]|$)/.test(rest);
}

export function injectTarget(command: string, pane: string): string | null {
  const parsed = parseTmuxCommand(command);
  if (!parsed) return null;
  if (!targetableCommands.has(parsed.subcommand)) return null;
  if (hasExistingTarget(parsed.rest)) return null;

  return `tmux ${parsed.subcommand} -t "${pane}"${parsed.rest}`;
}

export function processInput(input: PreToolUseHookInput, pane?: string): SyncHookJSONOutput | null {
  if (!pane) return null;

  const { command } = input.tool_input as { command?: string };
  if (!command) return null;

  const rewritten = injectTarget(command, pane);
  if (!rewritten) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: {
        command: rewritten,
      },
      additionalContext: `tmux target auto-injected: -t "${pane}" (your pane). To target the user's active pane, resolve it explicitly:\n  target=$(tmux display-message -p '#{pane_id}') && tmux <cmd> -t "$target" ...`,
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[tmux/target] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input, process.env.TMUX_PANE);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
