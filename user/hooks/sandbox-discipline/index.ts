#!/usr/bin/env bun

import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { commandVerbs, describeVerb, rewriteCdGit } from "./command";
import { hasMarkedScript } from "./marker";
import { findSandboxFailure } from "./transcript";

export type BashInput = {
  command?: string;
  dangerouslyDisableSandbox?: boolean;
};

/**
 * Sign-in flows that hand off to a browser. Launch Services handoff does not survive the
 * Seatbelt container whatever the profile allows, so these can never produce the sandbox
 * failure the gate otherwise asks for, and `plugins/gitlab/hooks/auth.ts` tells the model
 * to run one with the bypass. Retire an entry when its tool stops needing a browser.
 */
const BROWSER_HANDOFF = /\b(?:gh|glab)\s+auth\s+login\b/;

export type HookOutput = SyncHookJSONOutput & {
  hookSpecificOutput: PreToolUseHookSpecificOutput;
};

export function formatDenyOutput(verb: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Run \`${verb}\` sandboxed first. \`dangerouslyDisableSandbox\` is for a command the sandbox has already refused, and this session has no failed sandboxed \`${verb}\` run to point at. Re-run without the bypass. If it fails with a sandbox error, retry with the bypass and this hook will let it through.`,
    },
  };
}

export function formatRewriteOutput(
  toolInput: Record<string, unknown>,
  command: string,
): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, command },
    },
  };
}

export async function processInput(input: PreToolUseHookInput): Promise<HookOutput | null> {
  const toolInput = input.tool_input as Record<string, unknown>;
  const { command, dangerouslyDisableSandbox } = toolInput as BashInput;
  if (!command) return null;

  if (dangerouslyDisableSandbox === true) {
    return gateBypass(input, command);
  }

  const rewritten = rewriteCdGit(command);
  return rewritten ? formatRewriteOutput(toolInput, rewritten) : null;
}

async function gateBypass(input: PreToolUseHookInput, command: string): Promise<HookOutput | null> {
  const verbs = commandVerbs(command);

  if (BROWSER_HANDOFF.test(command)) return null;
  if (await hasMarkedScript(command, input.cwd)) return null;
  if (input.transcript_path && (await findSandboxFailure(input.transcript_path, verbs))) {
    return null;
  }

  return formatDenyOutput(describeVerb(command, verbs));
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[sandbox-discipline] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
