#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const WebFetchInput = z.looseObject({ url: z.string() });
export type WebFetchInput = z.infer<typeof WebFetchInput>;

export const HookInput = z.looseObject({ tool_input: z.unknown() });
export type HookInput = z.infer<typeof HookInput>;

const PUBLIC_PATH_PREFIXES = ["/docs", "/developers", "/changelog"];

export function isPublicUrl(url: string): boolean {
  const path = new URL(url).pathname;
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function formatOutput(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const url = WebFetchInput.safeParse(input.tool_input).data?.url;
  if (url === undefined || isPublicUrl(url)) {
    return null;
  }

  return formatOutput(
    "Linear requires authentication. Use Linear MCP instead. Run /linear for guidance.",
  );
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[linear/fetch] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
