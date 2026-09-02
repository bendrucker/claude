#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { BashHookInput, readHookInput } from "./hook-input";

export const HookInput = BashHookInput.extend({
  hook_event_name: z.literal("PostToolUse"),
  tool_response: z.unknown(),
});
export type HookInput = z.infer<typeof HookInput>;

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const command = input.tool_input.command;
  if (command == null || command === "" || !command.includes("glab")) return null;

  const response = JSON.stringify(input.tool_response ?? "");
  if (!response.includes("invalid_grant")) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "glab OAuth token expired. Run: glab auth login --hostname gitlab.com --git-protocol ssh (requires dangerouslyDisableSandbox: true for browser OAuth flow)",
    },
  };
}

async function main(): Promise<void> {
  const input = await readHookInput(HookInput, "auth");
  if (input == null) return;

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
