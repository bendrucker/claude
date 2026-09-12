#!/usr/bin/env bun

import { basename, extname } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

// This hook gates every Bash call and cannot report a failure to load, so it
// narrows its input by hand and carries no runtime dependency.
interface HookInput {
  tool_input?: unknown;
}

interface CommandInput {
  command: string;
}

function hasCommand(toolInput: unknown): toolInput is CommandInput {
  if (toolInput == null || typeof toolInput !== "object") return false;
  if (!("command" in toolInput)) return false;
  return typeof toolInput.command === "string" && toolInput.command !== "";
}

function isPreToolUse(value: unknown): value is HookInput {
  if (value == null || typeof value !== "object") return false;
  return "hook_event_name" in value && value.hook_event_name === "PreToolUse";
}

const SHELL_OPERATORS = /\s*(?:&&|\|\||[|;])\s*/;
const SCRIPT_INTERPRETERS = new Set(["bun", "node"]);
// Gating on extensions keeps the hook from reading the head of every binary it sees.
const SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".sh"]);
const SCRIPT_MARKER = "claude:dangerouslyDisableSandbox";

export interface Invocation {
  cmd: string;
  scriptArg?: string;
}

export function extractCommands(command: string): Invocation[] {
  const segments = command.split(SHELL_OPERATORS);
  const result: Invocation[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim().replaceAll(/^[()]+|[()]+$/g, "");
    if (trimmed === "") continue;

    const tokens = trimmed.split(/\s+/);
    let i = 0;

    // skip env var prefixes (FOO=bar)
    while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i] ?? "")) {
      i++;
    }

    const cmd = tokens[i];
    if (cmd == null || cmd === "") continue;

    const name = basename(cmd);
    const invocation: Invocation = { cmd };
    if (SCRIPT_INTERPRETERS.has(name)) {
      const next = tokens[i + 1];
      if (next != null && next !== "" && !next.startsWith("-")) {
        invocation.scriptArg = next;
      }
    } else if (SCRIPT_EXTENSIONS.has(extname(name))) {
      invocation.scriptArg = cmd;
    }
    result.push(invocation);
  }

  return result;
}

async function readHead(path: string, length = 65536): Promise<Buffer | null> {
  try {
    const file = Bun.file(path);
    const slice = file.slice(0, length);
    return Buffer.from(await slice.arrayBuffer());
  } catch {
    return null;
  }
}

export async function hasBypassMarker(path: string): Promise<boolean> {
  const head = await readHead(path);
  return head ? head.includes(SCRIPT_MARKER) : false;
}

function disableSandbox(toolInput: CommandInput): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, dangerouslyDisableSandbox: true },
    },
  };
}

export async function processInput(
  input: HookInput,
  platform = process.platform,
): Promise<SyncHookJSONOutput | null> {
  if (platform !== "darwin") return null;

  const toolInput = input.tool_input;
  if (!hasCommand(toolInput)) return null;

  for (const { scriptArg } of extractCommands(toolInput.command)) {
    // oxlint-disable-next-line no-await-in-loop -- first match wins: the scan stops at the first command carrying a bypass marker.
    if (scriptArg != null && scriptArg !== "" && (await hasBypassMarker(scriptArg))) {
      return disableSandbox(toolInput);
    }
  }

  return null;
}

async function main(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch (error) {
    console.error(
      `[mac/sandbox] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  if (!isPreToolUse(input)) {
    console.error("[mac/sandbox] Hook input is not a PreToolUse event");
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
