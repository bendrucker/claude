#!/usr/bin/env bun

import {
  type PreToolUseHookInput,
  preToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";

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
  const wrapperKey = keys.length === 1 ? keys[0] : undefined;
  if (wrapperKey && WRAPPER_KEYS.includes(wrapperKey) && isFieldObject(input[wrapperKey])) {
    input = input[wrapperKey] as Record<string, unknown>;
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
  const { input: normalized, mutated } = normalizeInput(
    input.tool_input as Record<string, unknown>,
  );
  const { id, title, state, assignee } = normalized;

  // An absent id means create (the connector's save_issue and the local
  // create_issue tool); present id means update.
  const isCreate = !id;

  // Unrecoverable: a create with no title cannot proceed. Deny with a message
  // that names neither tool, since this hook fires for both save_issue and
  // create_issue, so the model can recover by supplying title or id.
  if (isCreate && !title) {
    return preToolUse.deny(
      "Creating an issue requires `title`. To update an existing issue instead, pass its `id`.",
    );
  }

  // Preserve the original default-state behavior: inject a default only when
  // creating and state is absent. Never override an explicitly set state.
  const needsDefaultState = isCreate && !state;

  if (!mutated && !needsDefaultState) {
    return null;
  }

  // updatedInput replaces the entire input object and only applies under an
  // "allow" decision, which also bypasses the permission prompt. Echo back every
  // normalized field alongside any injected default state.
  const updatedInput: Record<string, unknown> = { ...normalized };
  if (needsDefaultState) {
    updatedInput.state = getDefaultState(assignee);
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput,
    },
  };
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, SyncHookJSONOutput>(processInput);
}
