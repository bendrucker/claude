#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type CreateIssueInput = {
  id?: string;
  title?: string;
  team?: string;
  state?: string;
  assignee?: string;
};

export function getDefaultState(assignee: string | undefined): string {
  return assignee ? "Todo" : "Backlog";
}

// Wrapper keys the connector tolerates inconsistently. A single one whose value
// is the real field object is unwrapped to flat top-level keys.
const WRAPPER_KEYS = ["issue", "input", "parameters"];

function isFieldObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type NormalizeResult = {
  input: CreateIssueInput & Record<string, unknown>;
  mutated: boolean;
};

// Mechanical, recoverable shape fixes: unwrap a single recognized wrapper and
// alias issueId to id. Unknown fields are left untouched; an allow/deny-list of
// save_issue fields is too brittle for a hook and drifts against the connector
// schema, so that guidance lives in the skill prose instead.
export function normalizeInput(toolInput: Record<string, unknown>): NormalizeResult {
  let mutated = false;
  let input: Record<string, unknown> = toolInput;

  const keys = Object.keys(input);
  if (keys.length === 1 && WRAPPER_KEYS.includes(keys[0]) && isFieldObject(input[keys[0]])) {
    input = input[keys[0]] as Record<string, unknown>;
    mutated = true;
  }

  if ("issueId" in input) {
    const { issueId, ...rest } = input;
    input = "id" in rest ? rest : { ...rest, id: issueId };
    mutated = true;
  }

  return { input: input as CreateIssueInput & Record<string, unknown>, mutated };
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { input: normalized, mutated } = normalizeInput(input.tool_input as Record<string, unknown>);
  const { id, title, state, assignee } = normalized;

  // claude.ai save_issue creates when id is absent and updates when present.
  const isCreate = !id;

  // Unrecoverable: a create with no title cannot proceed. Deny with a message
  // covering both modes so the model can recover by supplying title or id.
  if (isCreate && !title) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "`save_issue` creates when `id` is absent and requires `title`. To update an existing issue, pass its `id` from `get_issue`.",
      },
    };
  }

  // updatedInput replaces the entire input object and only applies under an
  // "allow" decision, which also bypasses the permission prompt. Echo back every
  // normalized field alongside any injected default state.
  const updatedInput: Record<string, unknown> = { ...normalized };
  let changed = mutated;

  // Preserve the original default-state behavior: inject a default only when
  // creating and state is absent. Never override an explicitly set state.
  if (isCreate && !state) {
    updatedInput.state = getDefaultState(assignee);
    changed = true;
  }

  if (!changed) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput,
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[linear/save-issue] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
