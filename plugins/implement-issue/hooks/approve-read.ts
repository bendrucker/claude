#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { type IssueTarget, readTarget } from "../scripts/target";

type IssueReadInput = {
  owner: string;
  repo: string;
  issue_number: number;
  method: string;
};

function matchesTarget(input: IssueReadInput, target: IssueTarget): boolean {
  return (
    input.owner === target.owner &&
    input.repo === target.repo &&
    input.issue_number === target.number
  );
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const target = readTarget(input.session_id);
  if (!target) return null;

  const toolInput = input.tool_input as IssueReadInput;
  if (!matchesTarget(toolInput, target)) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  };
}

if (import.meta.main) {
  (async () => {
    const { readStdinJson, writeStdoutJson } = await import("@constellos/claude-code-kit/runners");
    let input: PreToolUseHookInput;
    try {
      input = await readStdinJson<PreToolUseHookInput>();
    } catch (error) {
      console.error(
        `[implement-issue/approve-read] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const output = processInput(input);
    if (output) {
      writeStdoutJson(output);
    }
  })().catch(console.error);
}
