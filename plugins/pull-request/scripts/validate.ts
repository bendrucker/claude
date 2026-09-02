#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { validateBody } from "./body-rules";
import { gitRepo } from "./repo";
import { effectiveCwd, extractTitle, isPrBodyCommand, resolveBody } from "./resolve-body";

const BashInput = z.looseObject({ command: z.string() });

export const HookInput = z.looseObject({
  cwd: z.string().optional(),
  tool_input: z.unknown(),
});
export type HookInput = z.infer<typeof HookInput>;

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  const command = BashInput.safeParse(input.tool_input).data?.command;
  if (command === undefined || !isPrBodyCommand(command)) {
    return null;
  }
  const cwd = input.cwd ?? process.cwd();
  const resolved = await resolveBody(command, cwd);
  return validateBody(resolved.kind === "text" ? resolved.text : "", {
    title: extractTitle(command),
    unreadable: resolved.kind === "unreadable" ? resolved.detail : null,
    ...gitRepo(effectiveCwd(command, cwd)),
  });
}

function denyWithError(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } satisfies SyncHookJSONOutput;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Failed to parse hook input: ${message}`);
    denyWithError(`Validation hook failed to parse input: ${message}`);
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Unexpected error: ${message}`);
    denyWithError(`Validation hook encountered an error: ${message}`);
  });
}
