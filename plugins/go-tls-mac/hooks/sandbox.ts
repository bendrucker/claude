#!/usr/bin/env bun

import { basename } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

type BashInput = { command: string };

const SHELL_OPERATORS = /\s*(?:&&|\|\||[|;])\s*/;

export function extractCommands(command: string): string[] {
  const segments = command.split(SHELL_OPERATORS);
  const seen = new Set<string>();

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

    seen.add(basename(cmd));
  }

  return [...seen];
}

export async function isGoBinary(command: string): Promise<boolean> {
  try {
    const resolved = Bun.which(command);
    if (!resolved) return false;

    const file = Bun.file(resolved);
    const slice = file.slice(0, 65536);
    const bytes = Buffer.from(await slice.arrayBuffer());
    return bytes.includes("__go_buildinfo");
  } catch {
    return false;
  }
}

export async function processInput(
  input: PreToolUseHookInput,
  platform = process.platform,
): Promise<SyncHookJSONOutput | null> {
  if (platform !== "darwin") return null;

  const { command } = input.tool_input as BashInput;
  const commands = extractCommands(command);

  for (const cmd of commands) {
    if (await isGoBinary(cmd)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `Go binary "${cmd}" needs unsandboxed access for TLS cert verification on macOS`,
          updatedInput: { dangerouslyDisableSandbox: true },
        },
      };
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
      `[go-tls-mac/sandbox] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
