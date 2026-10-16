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
  "check-plugin-imports.ts",
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
      systemMessage: `plugin-imports: checker could not run; skipping cross-plugin import check.\n\n${String(error)}`,
    };
  }
  if (violations.length === 0) return null;

  return {
    decision: "block",
    reason: `Cross-plugin imports detected:\n\n${violationText(violations)}\n\nFix these imports before stopping. Plugins must not import from outside their own directory.`,
  };
}

async function main(): Promise<void> {
  const output = await processStop(await decodeStdin(StopInput, "plugin-imports hook input"));
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
