#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

const SIZE_THRESHOLD = 12_000;

// A re-present that keeps nearly every prior line and drops almost none regrew
// the document instead of consolidating superseded design and revising it.
const APPEND_ONLY_MIN_CARRYOVER = 0.9;
// Zero net growth is a no-op edit (or whitespace-only), not the regrowth pattern.
const APPEND_ONLY_MIN_GROWTH = 1;
// Allow one incidental drop (e.g. a stray line) without losing the append-only signal.
const APPEND_ONLY_MAX_REMOVED = 1;

// Direction Before Detail prescribes a skeletal first plan, so growth into the
// second present is the workflow working. Sustained growth starts at the third.
const GROWTH_MIN_PRESENTS = 3;
// Only one growth ask fires per session, so a plan that lands a hair over the
// high-water mark must not spend it. Require a margin that reads as accumulation.
const GROWTH_MIN_EXCESS_RATIO = 0.05;

const DENY_REASON =
  "Plan text is byte-identical to the presentation that was just rejected. Re-read " +
  "the user's messages since that presentation and revise the sections they name, " +
  "deleting anything they superseded. If the rejection carried no feedback, use " +
  "AskUserQuestion to get direction instead of resubmitting.";

const APPEND_ONLY_ASK_REASON =
  "This re-present keeps nearly every prior line and only adds new ones. Find what " +
  "the feedback superseded and delete it instead of writing around it. The plan is " +
  "the standalone execution document, not a record of this conversation. Approve to " +
  "present anyway.";

function growthAskReason(ordinal: number, previousMax: number, length: number): string {
  return (
    `Presentation ${ordinal} is larger than any before it (${previousMax} -> ${length} chars). ` +
    "If redirects added scope, that growth is right. Otherwise it is residue: delete " +
    "superseded design, move resolved research to <plan>-decisions.md, and keep only " +
    "what the implementer builds from. Approve to present anyway."
  );
}

const ASK_REASON =
  "This plan exceeds 12k characters. Plans this large are rarely approved. " +
  "Consolidate superseded content into <plan>-decisions.md or split the scope. " +
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

function normalizeLines(plan: string): Set<string> {
  const lines = new Set<string>();
  for (const rawLine of plan.split("\n")) {
    const line = rawLine.trim();
    if (line) lines.add(line);
  }
  return lines;
}

function parseLineSet(raw: string): Set<string> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return new Set(parsed);
  } catch {
    return null;
  }
}

type PresentHistory = { count: number; maxLength: number };

function parsePresentHistory(raw: string): PresentHistory | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { count, maxLength } = parsed as Record<string, unknown>;
    if (typeof count !== "number" || typeof maxLength !== "number") return null;
    return { count, maxLength };
  } catch {
    return null;
  }
}

function isAppendOnlyRevision(previous: Set<string>, current: Set<string>): boolean {
  if (previous.size === 0) return false;

  let carriedOver = 0;
  for (const line of previous) {
    if (current.has(line)) carriedOver++;
  }
  const carryOverRatio = carriedOver / previous.size;
  const removed = previous.size - carriedOver;
  const growth = current.size - previous.size;

  return (
    carryOverRatio >= APPEND_ONLY_MIN_CARRYOVER &&
    growth >= APPEND_ONLY_MIN_GROWTH &&
    removed <= APPEND_ONLY_MAX_REMOVED
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
  const presentsPath = join(dir, "exit-plan-presents");
  const growthAskedPath = join(dir, "exit-plan-growth-asked");
  const askedPath = join(dir, "exit-plan-size-asked");

  const hash = createHash("sha256").update(plan).digest("hex");
  const previous = await readState(hashPath);
  await writeState(hashPath, hash);

  const currentLines = normalizeLines(plan);
  const previousLinesRaw = await readState(linesPath);
  await writeState(linesPath, JSON.stringify(Array.from(currentLines)));

  if (previous !== null && previous === hash) {
    return formatDecision("deny", DENY_REASON);
  }

  // Past the deny, so a byte-identical resubmission neither advances the count
  // nor raises the high-water mark. An ask still does: the hook cannot observe
  // whether the user approved it.
  const presentsRaw = await readState(presentsPath);
  const history = presentsRaw === null ? null : parsePresentHistory(presentsRaw);
  const ordinal = (history?.count ?? 0) + 1;
  await writeState(
    presentsPath,
    JSON.stringify({ count: ordinal, maxLength: Math.max(history?.maxLength ?? 0, plan.length) }),
  );

  const previousLines = previousLinesRaw === null ? null : parseLineSet(previousLinesRaw);
  if (previousLines !== null && isAppendOnlyRevision(previousLines, currentLines)) {
    return formatDecision("ask", APPEND_ONLY_ASK_REASON);
  }

  if (
    history !== null &&
    ordinal >= GROWTH_MIN_PRESENTS &&
    plan.length > history.maxLength * (1 + GROWTH_MIN_EXCESS_RATIO) &&
    (await readState(growthAskedPath)) === null
  ) {
    await writeState(growthAskedPath, "asked");
    return formatDecision("ask", growthAskReason(ordinal, history.maxLength, plan.length));
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
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[plan/gate] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
