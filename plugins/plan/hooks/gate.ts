#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const ToolInput = z.looseObject({ plan: z.string().optional().catch(undefined) });

const HookInput = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  session_id: z.string().catch(""),
  transcript_path: z.string().catch(""),
  cwd: z.string().catch(""),
  tool_name: z.string().catch(""),
  tool_input: z.unknown().catch(undefined),
  tool_use_id: z.string().catch(""),
}) satisfies z.ZodType<PreToolUseHookInput>;

const SIZE_THRESHOLD = 12_000;

// A re-present that keeps nearly every prior line and drops almost none regrew
// the document instead of consolidating superseded design and revising it.
const APPEND_ONLY_MIN_CARRYOVER = 0.9;
// Count lines the re-present introduced, not net size. A swap that trades a few
// lines for a few new ones nets zero while carrying the whole prior document.
const APPEND_ONLY_MIN_ADDED = 1;
// Tolerate a handful of dropped lines: past the carry-over floor, a small removal
// count is line churn inside an otherwise intact document, not a revision. Binding
// only on plans over 30 unique lines, since below that the 0.9 floor is stricter.
const APPEND_ONLY_MAX_REMOVED = 3;

// Only one growth denial fires per session, so a plan that lands a hair over the
// high-water mark must not spend it. Require a margin that reads as accumulation.
const GROWTH_MIN_EXCESS_RATIO = 0.05;

// Every rule below denies. On ExitPlanMode a PreToolUse "ask" is inert: the tool
// runs its own plan-approval prompt, and the harness drops the hook's
// permissionDecisionReason and systemMessage alike, so neither the user nor the
// transcript ever sees them. Deny is the only decision that carries a reason back.
const DENY_REASON =
  "Plan text is byte-identical to the presentation that was just rejected. The plan " +
  "is the whole brief a fresh session implements from, so resubmitting it unchanged " +
  "cannot land. Rework it against the feedback since that presentation, deleting what " +
  "the feedback superseded. If the rejection carried none, ask with AskUserQuestion.";

const APPEND_ONLY_REASON =
  "This re-present carries nearly every prior line. A plan this close to the rejected " +
  "one needs reworking, not re-presenting. It will not be revised interactively. It " +
  "goes whole to a fresh session, so delete what the feedback superseded instead of " +
  "writing around it.";

function growthReason(ordinal: number, previousMax: number, length: number): string {
  return (
    `Presentation ${ordinal} is larger than any before it (${previousMax} -> ${length} chars). ` +
    "If redirects added scope, that growth is right. Otherwise it is residue the fresh " +
    "session pays for: delete superseded design, move resolved research to " +
    "<plan>-decisions.md, and keep only what the implementer builds from."
  );
}

const SIZE_REASON =
  "This plan exceeds 12k characters. The session that implements it reads it cold and " +
  "reads nothing else. Consolidate superseded content into <plan>-decisions.md or " +
  "split the scope.";

export class StateUnavailableError extends Error {
  constructor(directory: string, cause: unknown) {
    super(`cannot create the per-session state directory ${directory}`, { cause });
    this.name = "StateUnavailableError";
  }
}

function formatDecision(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
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

const PresentHistory = z.object({ count: z.number(), maxLength: z.number() });
type PresentHistory = z.infer<typeof PresentHistory>;

function parsePresentHistory(raw: string): PresentHistory | null {
  try {
    return PresentHistory.safeParse(JSON.parse(raw)).data ?? null;
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
  const added = current.size - carriedOver;

  return (
    carryOverRatio >= APPEND_ONLY_MIN_CARRYOVER &&
    added >= APPEND_ONLY_MIN_ADDED &&
    removed <= APPEND_ONLY_MAX_REMOVED
  );
}

export async function processInput(
  input: PreToolUseHookInput,
  stateRoot = process.env.CLAUDE_PLAN_MARKER_ROOT || "/tmp/claude",
): Promise<SyncHookJSONOutput | null> {
  const plan = ToolInput.safeParse(input.tool_input).data?.plan;
  if (plan === undefined) return null;

  const sessionId = input.session_id;
  if (!sessionId) return null;

  const dir = join(stateRoot, sessionId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    // Without state the gate is blind to every re-present rule, and a blind gate
    // is indistinguishable from a plan that passed. Say so rather than passing.
    throw new StateUnavailableError(dir, error);
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
    return formatDecision(DENY_REASON);
  }

  // Past the byte-identical check, so an unchanged resubmission neither advances
  // the count nor raises the high-water mark. Every other presentation does,
  // denied or not: the hook cannot observe what happened after it answered.
  const presentsRaw = await readState(presentsPath);
  const history = presentsRaw === null ? null : parsePresentHistory(presentsRaw);
  const ordinal = (history?.count ?? 0) + 1;
  await writeState(
    presentsPath,
    JSON.stringify({ count: ordinal, maxLength: Math.max(history?.maxLength ?? 0, plan.length) }),
  );

  const previousLines = previousLinesRaw === null ? null : parseLineSet(previousLinesRaw);
  if (previousLines !== null && isAppendOnlyRevision(previousLines, currentLines)) {
    return formatDecision(APPEND_ONLY_REASON);
  }

  // A non-null history means this is at least the second present, which is the
  // gate: the plan travels to a fresh session rather than looping in this one,
  // so there is no draft-then-detail round for growth to be part of.
  if (
    history !== null &&
    plan.length > history.maxLength * (1 + GROWTH_MIN_EXCESS_RATIO) &&
    (await readState(growthAskedPath)) === null
  ) {
    await writeState(growthAskedPath, "asked");
    return formatDecision(growthReason(ordinal, history.maxLength, plan.length));
  }

  if (plan.length > SIZE_THRESHOLD && (await readState(askedPath)) === null) {
    await writeState(askedPath, "asked");
    return formatDecision(SIZE_REASON);
  }

  return null;
}

// Fail open, but never silently: exit 1 lets the ExitPlanMode call through while
// the harness shows the stderr line, so a gate that has stopped deciding says so
// instead of reading as a plan that passed every rule.
function failOpen(problem: string, error: unknown): void {
  console.error(
    `[plan/gate] ${problem}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    failOpen("failed to parse hook input", error);
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => failOpen("failed to decide on this presentation", error));
}
