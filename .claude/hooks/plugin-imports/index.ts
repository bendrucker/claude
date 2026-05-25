#!/usr/bin/env bun

import { join } from "node:path";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export async function processInput(input: StopHookInput): Promise<SyncHookJSONOutput | null> {
  if (input.hook_event_name !== "Stop" || input.stop_hook_active) return null;

  const scriptPath = join(import.meta.dirname, "..", "..", "scripts", "check-plugin-imports.ts");
  const proc = Bun.spawn(["bun", scriptPath], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode === 0) return null;

  const stderr = await new Response(proc.stderr).text();

  return {
    decision: "block",
    reason: `Cross-plugin imports detected:\n\n${stderr}\n\nFix these imports before stopping. Plugins must not import from outside their own directory.`,
  };
}

async function main(): Promise<void> {
  let input: StopHookInput;
  try {
    input = await readStdinJson<StopHookInput>();
  } catch (error) {
    console.error(
      `[plugin-imports] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
