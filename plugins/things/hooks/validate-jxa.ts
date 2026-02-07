#!/usr/bin/env bun

import { join, resolve } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

type BashInput = { command: string };

export function processInput(
  input: PreToolUseHookInput,
  pluginRoot: string,
): SyncHookJSONOutput | null {
  const { command } = input.tool_input as BashInput;
  const trimmed = command.trim();

  if (!trimmed.startsWith("osascript")) {
    return null;
  }

  const scriptsDir = join(pluginRoot, "scripts", "jxa");
  const tokens = trimmed.split(/\s+/);
  const scriptPath = tokens.find((t) => t.includes(scriptsDir));
  if (scriptPath && resolve(scriptPath).startsWith(`${scriptsDir}/`)) {
    return allow("Running trusted Things plugin JXA script");
  }

  if (!trimmed.includes("-e")) {
    return null;
  }

  if (/Application\(\s*["']Things3["']\s*\)/.test(trimmed)) {
    const otherApps = trimmed.match(/Application\(\s*["'][^"']+["']\s*\)/g);
    const allThings = otherApps?.every((m) => m.includes("Things3"));
    if (allThings) {
      return allow("Inline JXA targeting Things3");
    }
    return deny("Inline JXA targets applications other than Things3");
  }

  return null;
}

function allow(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
    },
  };
}

function deny(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[things/validate-jxa] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    console.error("[things/validate-jxa] CLAUDE_PLUGIN_ROOT not set");
    return;
  }

  const output = processInput(input, pluginRoot);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
