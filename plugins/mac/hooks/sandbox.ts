#!/usr/bin/env bun

import { basename } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

type ToolInput = { command: string };

const SHELL_OPERATORS = /\s*(?:&&|\|\||[|;])\s*/;
const SCRIPT_INTERPRETERS = new Set(["bun", "node"]);
const SCRIPT_MARKER = "claude:sandbox-bypass";

export type Invocation = { cmd: string; scriptArg?: string };

export function extractCommands(command: string): Invocation[] {
  const segments = command.split(SHELL_OPERATORS);
  const seen = new Set<string>();
  const result: Invocation[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim().replace(/^[()]+|[()]+$/g, "");
    if (!trimmed) continue;

    const tokens = trimmed.split(/\s+/);
    let i = 0;

    // skip env var prefixes (FOO=bar)
    while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i] as string)) {
      i++;
    }

    const cmd = tokens[i];
    if (!cmd) continue;

    const name = basename(cmd);
    if (seen.has(name)) continue;
    seen.add(name);

    const invocation: Invocation = { cmd };
    if (SCRIPT_INTERPRETERS.has(name)) {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        invocation.scriptArg = next;
      }
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

export async function hasGoBuildInfo(path: string): Promise<boolean> {
  const head = await readHead(path);
  return head ? head.includes("__go_buildinfo") : false;
}

export async function hasBypassMarker(path: string): Promise<boolean> {
  const head = await readHead(path);
  return head ? head.includes(SCRIPT_MARKER) : false;
}

export async function isGoBinary(command: string): Promise<boolean> {
  const resolved = command.startsWith("/") ? command : Bun.which(command);
  if (!resolved) return false;
  return hasGoBuildInfo(resolved);
}

function disableSandbox(toolInput: Record<string, unknown>): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, dangerouslyDisableSandbox: true },
    },
  };
}

export async function processInput(
  input: PreToolUseHookInput,
  platform = process.platform,
): Promise<SyncHookJSONOutput | null> {
  if (platform !== "darwin") return null;

  const toolInput = input.tool_input as Record<string, unknown>;
  const { command } = toolInput as ToolInput;
  if (!command) return null;

  const invocations = extractCommands(command);

  for (const { cmd, scriptArg } of invocations) {
    if (await isGoBinary(cmd)) {
      return disableSandbox(toolInput);
    }
    if (scriptArg && (await hasBypassMarker(scriptArg))) {
      return disableSandbox(toolInput);
    }
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[mac/sandbox] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
