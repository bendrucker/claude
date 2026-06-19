#!/usr/bin/env bun

import { join } from "node:path";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

// Mirrors VIOLATION_EXIT in scripts/check-plugin-deps.ts. Deliberately a
// literal rather than an import: importing the checker would pull its module
// graph into the hook, so a checker that cannot load would crash the hook
// instead of reaching the non-blocking "checker could not run" path below.
// The hook's test imports both to keep the values in sync.
const VIOLATION_EXIT = 2;

const CHECKER_PATH = join(import.meta.dirname, "..", "..", "..", "scripts", "check-plugin-deps.ts");

export async function processStop(
  input: StopHookInput,
  checkerPath = CHECKER_PATH,
): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) return null;

  const proc = Bun.spawn(["bun", checkerPath], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode === 0) return null;

  const stderr = await new Response(proc.stderr).text();

  if (exitCode === VIOLATION_EXIT) {
    return {
      decision: "block",
      reason: `Missing plugin dependencies detected:\n\n${stderr}\n\nDeclare these in the plugin's package.json before stopping. Plugins must declare every npm package they import.`,
    };
  }

  // Any other non-zero exit means the checker itself failed to run (e.g.
  // module resolution failure). Surface it without blocking the stop.
  return {
    systemMessage: `plugin-deps: checker could not run (exit ${exitCode}); skipping plugin dependency check.\n\n${stderr.trim()}`,
  };
}

async function main(): Promise<void> {
  const input = await readStdinJson<StopHookInput>();
  if (input.hook_event_name !== "Stop") return;

  const output = await processStop(input);
  if (output) writeStdoutJson(output);
}

if (import.meta.main) {
  main().catch(console.error);
}
