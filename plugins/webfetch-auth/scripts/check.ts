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
  const toolInput = input.tool_input;

  if (!toolInput || typeof toolInput !== "object") {
    return formatOutput(
      "deny",
      "webfetch-auth hook received invalid input. Blocking as a safety measure.",
    );
  }

  const { url } = toolInput as WebFetchInput;

  if (typeof url !== "string") {
    return formatOutput(
      "deny",
      "webfetch-auth hook received invalid URL. Blocking as a safety measure.",
    );
  }

  const match = authenticatedDomains.find((domain) => domain.pattern.test(url));
  return match ? formatOutput("deny", match.suggestion) : null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webfetch-auth/check] Failed to parse hook input: ${message}`);
    writeStdoutJson(
      formatOutput("deny", `webfetch-auth hook error: ${message}. Blocking as a safety measure.`),
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `[webfetch-auth/check] Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
