#!/usr/bin/env bun

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decodeStdin } from "../../../packages/decode/index";
import { importViolations, violationText } from "../../../scripts/check";

const StopInput = z.looseObject({
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean().optional(),
});

type StopInput = z.infer<typeof StopInput>;

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

  let violations: string[];
  try {
    violations = await importViolations(checkerPath);
  } catch (error) {
    // A checker that cannot load or throws is surfaced without blocking the stop.
    return {
      systemMessage: `workspace-deps: checker could not run; skipping workspace dependency check.\n\n${String(error)}`,
    };
  }
  if (violations.length === 0) return null;

  return {
    decision: "block",
    reason: `Missing workspace dependencies detected:\n\n${violationText(violations)}\n\nDeclare these in the workspace's own package.json before stopping. Every workspace resolves independently, so relying on the root to hoist a package is what lets an undeclared import pass locally and fail on install.`,
  };
}

async function main(): Promise<void> {
  const output = await processStop(await decodeStdin(StopInput, "workspace-deps hook input"));
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
