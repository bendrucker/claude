#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const SIZE_THRESHOLD = 12_000;

// Append-only growth: the re-present keeps nearly all prior lines and only
// adds new ones, the shape the guidelines' Revision section forbids
// (regrowing the document instead of consolidating). Thresholds are lenient
// so an incidental edit or two doesn't false-positive.
const APPEND_ONLY_CARRY_OVER_THRESHOLD = 0.9;
const APPEND_ONLY_MAX_LINES_REMOVED = 1;

const DENY_REASON =
  "Plan text is unchanged since the last presentation. Incorporate the redirect " +
  "feedback with a targeted revision of the affected sections (do not regrow the " +
  "document), lead with a short 'Changed since last plan' block, and re-present.";

const APPEND_ONLY_ASK_REASON =
  "This re-present keeps nearly all of the prior plan and only adds lines, the " +
  "append-only growth the Revision guidelines warn against. Consolidate superseded " +
  "design into a two-line pointer, lead with a 'Changed since last plan' block, " +
  "and re-present the delta, not the regrown document. Approve to present anyway.";

const ASK_REASON =
  "This plan exceeds 12k characters. Plans this large are rarely approved; " +
  "consolidate superseded content into <plan>.decisions.md or split the scope. " +
  "Approve to present anyway.";

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

function normalizedLines(plan: string): Set<string> {
  const lines = new Set<string>();
  for (const line of plan.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) lines.add(trimmed);
  }
  return lines;
}

async function readLineState(path: string): Promise<Set<string> | null> {
  const raw = await readState(path);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return null;
  }
}

async function writeLineState(path: string, lines: Set<string>): Promise<void> {
  await writeState(path, JSON.stringify([...lines]));
}

function isAppendOnly(previous: Set<string>, current: Set<string>): boolean {
  if (previous.size === 0) return false;

  let carriedOver = 0;
  for (const line of previous) {
    if (current.has(line)) carriedOver++;
  }
  const removed = previous.size - carriedOver;
  const growth = current.size - previous.size;
  const carryOverRatio = carriedOver / previous.size;

  return (
    carryOverRatio >= APPEND_ONLY_CARRY_OVER_THRESHOLD &&
    growth > 0 &&
    removed <= APPEND_ONLY_MAX_LINES_REMOVED
  );
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
  const linesPath = join(dir, "exit-plan-lines");
  const askedPath = join(dir, "exit-plan-size-asked");

  const hash = createHash("sha256").update(plan).digest("hex");
  const previous = await readState(hashPath);
  await writeState(hashPath, hash);

  const currentLines = normalizedLines(plan);
  const previousLines = await readLineState(linesPath);
  await writeLineState(linesPath, currentLines);

  if (previous !== null && previous === hash) {
    return formatDecision("deny", DENY_REASON);
  }

  if (previousLines !== null && isAppendOnly(previousLines, currentLines)) {
    return formatDecision("ask", APPEND_ONLY_ASK_REASON);
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
