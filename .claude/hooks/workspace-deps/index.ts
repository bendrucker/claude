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

// Deliberately a literal rather than an import: importing the checker would
// pull its module graph into the hook, so a checker that cannot load would
// crash the hook. The hook's test imports both to keep the values in sync.
const VIOLATION_EXIT = 2;

const CHECKER_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "scripts",
  "check-workspace-deps.ts",
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
      reason: `Missing workspace dependencies detected:\n\n${stderr}\n\nDeclare these in the workspace's own package.json before stopping. Every workspace resolves independently, so relying on the root to hoist a package is what lets an undeclared import pass locally and fail on install.`,
    };
  }

  // Any other non-zero exit means the checker itself failed to run (e.g.
  // module resolution failure). Surface it without blocking the stop.
  return {
    systemMessage: `workspace-deps: checker could not run (exit ${exitCode}); skipping workspace dependency check.\n\n${stderr.trim()}`,
  };
}

async function main(): Promise<void> {
  const output = await processStop(await decodeStdin(StopInput, "workspace-deps hook input"));
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
