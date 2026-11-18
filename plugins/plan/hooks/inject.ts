#!/usr/bin/env bun

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

interface HookInput {
  hook_event_name: string;
  session_id?: unknown;
  permission_mode?: unknown;
  tool_name?: unknown;
  source?: unknown;
}

interface Output {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

const GUIDELINES = join(import.meta.dirname, "..", "references", "guidelines.md");
const MARKER = "plan-guidelines-injected";

function isHookInput(value: unknown): value is HookInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "hook_event_name" in value &&
    typeof value.hook_event_name === "string"
  );
}

function defaultStateRoot(): string {
  const override = process.env.CLAUDE_PLAN_MARKER_ROOT;
  return override !== undefined && override !== "" ? override : "/tmp/claude";
}

function reachesPlanMode(input: HookInput): boolean {
  if (input.hook_event_name === "PostToolUse") return input.tool_name === "EnterPlanMode";
  return input.hook_event_name === "UserPromptSubmit" && input.permission_mode === "plan";
}

export async function processInput(
  input: HookInput,
  stateRoot = defaultStateRoot(),
  guidelinesPath = GUIDELINES,
): Promise<Output | null> {
  if (typeof input.session_id !== "string" || input.session_id === "") return null;
  const dir = join(stateRoot, input.session_id);
  const marker = join(dir, MARKER);

  // A compaction drops the guidelines from context. Clearing the marker re-injects them.
  if (input.hook_event_name === "SessionStart") {
    if (input.source === "compact") await rm(marker, { force: true });
    return null;
  }

  if (!reachesPlanMode(input) || (await Bun.file(marker).exists())) return null;
  const guidelines = await Bun.file(guidelinesPath).text();
  await mkdir(dir, { recursive: true });
  await Bun.write(marker, "");
  return {
    hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: guidelines },
  };
}

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(await Bun.stdin.text());
  if (!isHookInput(raw)) throw new Error("hook input has no hook_event_name");
  const output = await processInput(raw);
  if (output !== null) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[plan/inject] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
