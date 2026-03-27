#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type WebFetchInput = { url: string; prompt: string };

type BlockedPattern = {
  pattern: RegExp;
  suggestion: string;
};

// Blocks URLs that require authentication, don't exist, or reject bot requests.
// Services with plugins (GitHub, GitLab, Linear) handle blocking in their own hooks.
const blockedPatterns: BlockedPattern[] = [
  {
    pattern: /^https:\/\/docs\.google\.com\//,
    suggestion: "Google Docs requires authentication. Use Google Drive MCP or export as PDF.",
  },
  {
    pattern: /^https:\/\/[^/]+\.atlassian\.net\//,
    suggestion: "Atlassian sites require authentication. Use Confluence or Jira MCP.",
  },
  {
    pattern: /^https:\/\/[^/]+\.notion\.so\//,
    suggestion: "Notion requires authentication. Use Notion MCP.",
  },
  {
    pattern: /^https:\/\/code\.claude\.com\//,
    suggestion:
      "code.claude.com is not a real site. Claude Code docs are at docs.anthropic.com/en/docs/claude-code/.",
  },
  {
    pattern: /^https:\/\/www\.npmjs\.com\/package\//,
    suggestion:
      "npmjs.com blocks automated requests. Use: npm view <package> [field]. For versions: npm view <package> versions --json.",
  },
];

export function formatOutput(
  decision: "allow" | "deny" | "ask",
  reason: string,
): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { url } = input.tool_input as WebFetchInput;

  for (const blocked of blockedPatterns) {
    if (blocked.pattern.test(url)) {
      return formatOutput("deny", blocked.suggestion);
    }
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[webfetch-block] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
