#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type WebFetchInput = { url: string; prompt: string };

type AuthenticatedDomain = {
  pattern: RegExp;
  suggestion: string;
};

const authenticatedDomains: AuthenticatedDomain[] = [
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
    pattern: /^https:\/\/linear\.app\//,
    suggestion: "Linear requires authentication. Use Linear MCP or load `linear:linear` skill.",
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

  for (const domain of authenticatedDomains) {
    if (domain.pattern.test(url)) {
      return formatOutput("deny", domain.suggestion);
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
