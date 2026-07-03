#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const SIZE_THRESHOLD = 12_000;

const DENY_REASON =
  "Plan text is unchanged since the last presentation. Incorporate the redirect " +
  "feedback with a targeted revision of the affected sections (do not regrow the " +
  "document), lead with a short 'Changed since last plan' block, and re-present.";

const ASK_REASON =
  "This plan is over 12k characters; no plan over ~11.4k has been approved in two " +
  "months. Consider consolidating superseded content into <plan>.decisions.md or " +
  "splitting scope. Approve to present anyway.";

function formatDecision(decision: "deny" | "ask", reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

async function readState(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

async function writeState(path: string, content: string): Promise<void> {
  try {
    await Bun.write(path, content);
  } catch {
    // Fail open: losing state must never block the tool call.
  }
}

export async function processInput(
  input: PreToolUseHookInput,
  stateRoot = process.env.CLAUDE_PLAN_MARKER_ROOT || "/tmp/claude",
): Promise<SyncHookJSONOutput | null> {
  const plan = (input.tool_input as { plan?: unknown }).plan;
  if (typeof plan !== "string") return null;

  const sessionId = input.session_id;
  if (!sessionId) return null;

  const dir = join(stateRoot, sessionId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }

  const hashPath = join(dir, "exit-plan-hash");
  const askedPath = join(dir, "exit-plan-size-asked");

  const hash = createHash("sha256").update(plan).digest("hex");
  const previous = await readState(hashPath);
  await writeState(hashPath, hash);

  if (previous !== null && previous === hash) {
    return formatDecision("deny", DENY_REASON);
  }

  if (plan.length > SIZE_THRESHOLD && (await readState(askedPath)) === null) {
    await writeState(askedPath, "asked");
    return formatDecision("ask", ASK_REASON);
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[plan/gate] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
