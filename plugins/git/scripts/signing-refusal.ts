#!/usr/bin/env bun

import type {
  PostToolUseFailureHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { PostToolUseFailure } from "./hook-input";

/**
 * `ssh-keygen -Y sign` reports an agent refusal as `Couldn't sign message (signer): ...`
 * and `Signing <file> failed: ...`. The SSH transport's refusal reads
 * `sign_and_send_pubkey: signing failed`, which this deliberately does not match.
 */
const SIGNING_REFUSAL = /(?:Couldn't sign message|Signing .+ failed).*agent refused operation/;

export function hasSigningRefusal(output: string): boolean {
  return SIGNING_REFUSAL.test(output);
}

export const CONTEXT = [
  "Git could not sign: the SSH agent refused because nobody approved its Touch ID prompt. Retrying unattended fails the same way.",
  "Stop and ask the user to approve the Touch ID prompt, then retry once they confirm. Keep signing enabled.",
].join("\n");

export function processInput(input: PostToolUseFailureHookInput): SyncHookJSONOutput | null {
  if (!hasSigningRefusal(input.error)) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: CONTEXT,
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseFailureHookInput;
  try {
    input = PostToolUseFailure.parse(JSON.parse(await Bun.stdin.text()));
  } catch {
    // Malformed hook input must not crash the hook. Skip this invocation.
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
