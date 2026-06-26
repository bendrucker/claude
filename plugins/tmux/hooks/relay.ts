#!/usr/bin/env bun

import type { SyncHookJSONOutput, UserPromptSubmitHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export interface RelayEnvelope {
  from: string;
  replyTo: string;
  kind: string;
  window: string | null;
  body: string;
}

const HEADER = /^\[\[tmux-relay\s+([^\]]*)\]\]\s*\n?([\s\S]*)$/;

/**
 * Parse a relay envelope from the first line of a submitted prompt. Returns
 * null for ordinary prompts so the hook is a no-op on everything but peer mail.
 */
export function parseEnvelope(prompt: string): RelayEnvelope | null {
  const match = prompt.match(HEADER);
  if (!match) return null;

  const attrs = new Map<string, string>();
  for (const token of (match[1] ?? "").trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) attrs.set(token.slice(0, eq), token.slice(eq + 1));
  }

  const from = attrs.get("from");
  if (!from) return null;

  return {
    from,
    replyTo: attrs.get("reply-to") ?? from,
    kind: attrs.get("kind") ?? "message",
    window: attrs.get("window") ?? null,
    body: match[2] ?? "",
  };
}

export function buildContext(env: RelayEnvelope): string {
  const origin = env.window ? `${env.from} (window ${env.window})` : env.from;
  return [
    "This prompt is a tmux-relay message from another Claude Code session, not from the user.",
    "",
    `- From pane: ${origin}`,
    `- Reply to pane: ${env.replyTo}`,
    `- Kind: ${env.kind}`,
    "",
    "The text after the header line is the peer's message. Load the tmux:relay skill to",
    `respond: send your reply to pane ${env.replyTo} so it routes back. Keep the exchange`,
    "going until the request is resolved, and stamp every reply with your own pane.",
  ].join("\n");
}

export function processPrompt(prompt: string | undefined): SyncHookJSONOutput | null {
  if (!prompt) return null;
  const env = parseEnvelope(prompt);
  if (!env) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildContext(env),
    },
  };
}

async function main(): Promise<void> {
  let input: UserPromptSubmitHookInput;
  try {
    input = await readStdinJson<UserPromptSubmitHookInput>();
  } catch (error) {
    console.error(
      `[tmux/relay] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processPrompt(input.prompt);
  if (output) writeStdoutJson(output);
}

if (import.meta.main) {
  main().catch(console.error);
}
