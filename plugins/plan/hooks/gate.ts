#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkBrief } from "./brief";

interface HookInput {
  session_id: string;
  tool_input: { plan: string };
}

interface Output {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
}

// Past this many denies the presentation goes to the user. A deny loop is impossible.
export const MAX_FIRES = 2;
export const PASSED_MARKER = "exit-plan-passed";
const FIRES_MARKER = "exit-plan-brief-fires";

export class StateUnavailableError extends Error {
  constructor(directory: string, cause: unknown) {
    super(`cannot create the per-session state directory ${directory}`, { cause });
    this.name = "StateUnavailableError";
  }
}

export function isHookInput(value: unknown): value is HookInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "session_id" in value &&
    typeof value.session_id === "string" &&
    "tool_input" in value &&
    typeof value.tool_input === "object" &&
    value.tool_input !== null &&
    "plan" in value.tool_input &&
    typeof value.tool_input.plan === "string"
  );
}

export function defaultStateRoot(): string {
  const override = process.env.CLAUDE_PLAN_MARKER_ROOT;
  return override !== undefined && override !== "" ? override : "/tmp/claude";
}

async function readState(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : null;
}

export function denyReason(problems: string[]): string {
  return [
    "The plan's Brief does not match the shape in the planning guidelines:",
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n");
}

export async function processInput(
  input: HookInput,
  stateRoot = defaultStateRoot(),
): Promise<Output | null> {
  if (input.session_id === "") return null;

  const dir = join(stateRoot, input.session_id);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    // A gate without state cannot tell a first presentation from a revision. Say so rather than passing.
    throw new StateUnavailableError(dir, error);
  }

  const passedPath = join(dir, PASSED_MARKER);
  const firesPath = join(dir, FIRES_MARKER);
  // A passed presentation went to the user. Approval clears this marker, and a rejection leaves it.
  const revisionRequired = (await readState(passedPath)) === "1";
  const problems = checkBrief(input.tool_input.plan, { revisionRequired });

  const fires = Number((await readState(firesPath)) ?? 0);
  if (problems.length === 0 || !Number.isInteger(fires) || fires >= MAX_FIRES) {
    await Bun.write(passedPath, "1");
    return null;
  }

  await Bun.write(firesPath, String(fires + 1));
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: denyReason(problems),
    },
  };
}

// Fail open, but never silently. Exit 1 lets the ExitPlanMode call through while the harness
// shows the stderr line. A gate that has stopped deciding then does not read as a plan that passed.
function failOpen(problem: string, error: unknown): void {
  console.error(
    `[plan/gate] ${problem}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Bun.stdin.text());
  } catch (error) {
    failOpen("failed to parse hook input", error);
    return;
  }
  if (!isHookInput(raw)) return;

  const output = await processInput(raw);
  if (output !== null) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    failOpen("failed to decide on this presentation", error);
  });
}
