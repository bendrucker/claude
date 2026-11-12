#!/usr/bin/env bun

import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { commandsOf, parseCommands } from "./command-segments";
import { bashCommand, isPostToolUse, isRecord, readHookInput } from "./hook-input";

export type HookInput = PostToolUseHookInput | PostToolUseFailureHookInput;

const AUTH_FAILURES = [/invalid_grant/, /no access or refresh token/i, /\b401 Unauthorized\b/];

// A failed call carries its output in `error`. A successful one is read from
// stderr only, so a log that prints an auth error on stdout is not mistaken for
// glab's own failure.
function outputText(input: HookInput): string {
  if ("error" in input && typeof input.error === "string") return input.error;
  if (!("tool_response" in input)) return "";
  const response = input.tool_response;
  return isRecord(response) && typeof response.stderr === "string" ? response.stderr : "";
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const command = bashCommand(input.tool_input);
  if (command == null || !command.includes("glab")) return null;
  if (commandsOf(parseCommands(command), "glab").length === 0) return null;

  const output = outputText(input);
  if (!AUTH_FAILURES.some((pattern) => pattern.test(output))) return null;

  return {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name,
      additionalContext:
        "glab auth failed (expired or missing token). Run: glab auth login --hostname <host> with the GitLab host the command targeted (requires dangerouslyDisableSandbox: true for browser OAuth flow)",
    },
  };
}

async function main(): Promise<void> {
  const input = await readHookInput(isPostToolUse, "auth");
  if (input == null) return;

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
