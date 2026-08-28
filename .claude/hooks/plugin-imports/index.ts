#!/usr/bin/env bun

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decodeStdin } from "../../../packages/decode/index";

const StopInput = z.looseObject({
  hook_event_name: z.literal("Stop"),
  cwd: z.string(),
  stop_hook_active: z.boolean().optional(),
});

type StopInput = z.infer<typeof StopInput>;

// Mirrors VIOLATION_EXIT in scripts/check-plugin-imports.ts. Deliberately a
// literal rather than an import: importing the checker would pull its module
// graph into the hook, so a checker that cannot load would crash the hook
// instead of reaching the non-blocking "checker could not run" path below.
// The hook's test imports both to keep the values in sync.
const VIOLATION_EXIT = 2;

const CHECKER_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "scripts",
  "check-plugin-imports.ts",
);

export async function processStop(
  input: StopInput,
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
      reason: `Cross-plugin imports detected:\n\n${stderr}\n\nFix these imports before stopping. Plugins must not import from outside their own directory.`,
    };
  }

  // Any other non-zero exit means the checker itself failed to run (e.g.
  // module resolution failure). Surface it without blocking the stop.
  return {
    systemMessage: `plugin-imports: checker could not run (exit ${exitCode}); skipping cross-plugin import check.\n\n${stderr.trim()}`,
  };
}

async function main(): Promise<void> {
  const output = await processStop(await decodeStdin(StopInput, "plugin-imports hook input"));
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
