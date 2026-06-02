#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { runHook } from "@bendrucker/claude-hook";
import { type IssueTarget, readTarget } from "../scripts/target";

type IssueReadInput = {
  owner: string;
  repo: string;
  issue_number: number;
  method: string;
};

function matchesTarget(input: IssueReadInput, target: IssueTarget): boolean {
  if (target.service !== "github") return false;
  return (
    input.owner === target.owner &&
    input.repo === target.repo &&
    input.issue_number === target.number
  );
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const target = await readTarget(input.session_id);
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
  runHook(processInput, "issue/approve-read");
}
