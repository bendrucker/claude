#!/usr/bin/env bun

import { basename, extname } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ToolInput = z.looseObject({ command: z.string().optional().catch(undefined) });

const HookInput = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  session_id: z.string().catch(""),
  transcript_path: z.string().catch(""),
  cwd: z.string().catch(""),
  tool_name: z.string().catch(""),
  tool_input: z.unknown().catch(undefined),
  tool_use_id: z.string().catch(""),
}) satisfies z.ZodType<PreToolUseHookInput>;

const SHELL_OPERATORS = /\s*(?:&&|\|\||[|;])\s*/;
const SCRIPT_INTERPRETERS = new Set(["bun", "node"]);
// Gating on extensions keeps the hook from reading the head of every binary it sees.
const SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".sh"]);
const SCRIPT_MARKER = "claude:dangerouslyDisableSandbox";

export type Invocation = { cmd: string; scriptArg?: string };

export function extractCommands(command: string): Invocation[] {
  const segments = command.split(SHELL_OPERATORS);
  const result: Invocation[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim().replace(/^[()]+|[()]+$/g, "");
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

function disableSandbox(toolInput: z.infer<typeof ToolInput>): SyncHookJSONOutput {
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

  const toolInput = ToolInput.safeParse(input.tool_input).data;
  if (toolInput?.command == null || toolInput.command === "") return null;

  for (const { scriptArg } of extractCommands(toolInput.command)) {
    // oxlint-disable-next-line no-await-in-loop -- first match wins: the scan stops at the first command carrying a bypass marker.
    if (scriptArg != null && scriptArg !== "" && (await hasBypassMarker(scriptArg))) {
      return disableSandbox(toolInput);
    }
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[mac/sandbox] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
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
