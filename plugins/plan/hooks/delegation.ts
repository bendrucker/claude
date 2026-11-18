#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

interface HookInput {
  session_id: string;
  tool_input: { file_path: string };
}

interface Output {
  hookSpecificOutput: { hookEventName: "PostToolUse"; additionalContext: string };
}

export const DELEGATION_FROM = 5_000;
const DELEGATION_HEADING = /^#{1,6}\s+Delegation\b/m;
const REFERENCE = join(import.meta.dirname, "..", "references", "delegation.md");

function isHookInput(value: unknown): value is HookInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "session_id" in value &&
    typeof value.session_id === "string" &&
    "tool_input" in value &&
    typeof value.tool_input === "object" &&
    value.tool_input !== null &&
    "file_path" in value.tool_input &&
    typeof value.tool_input.file_path === "string"
  );
}

function defaultStateRoot(): string {
  const override = process.env.CLAUDE_PLAN_MARKER_ROOT;
  return override !== undefined && override !== "" ? override : "/tmp/claude";
}

export async function processInput(
  input: HookInput,
  stateRoot = defaultStateRoot(),
  referencePath = REFERENCE,
): Promise<Output | null> {
  const planPath = input.tool_input.file_path;
  if (input.session_id === "" || !planPath.endsWith(".md")) return null;

  const dir = join(stateRoot, input.session_id);
  const marker = join(dir, `delegation-${basename(planPath)}`);
  if (await Bun.file(marker).exists()) return null;

  const plan = await Bun.file(planPath).text();
  if (plan.length < DELEGATION_FROM || DELEGATION_HEADING.test(plan)) return null;

  const reference = await Bun.file(referencePath).text();
  await mkdir(dir, { recursive: true });
  await Bun.write(marker, "");
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: reference } };
}

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(await Bun.stdin.text());
  if (!isHookInput(raw)) return;
  const output = await processInput(raw);
  if (output !== null) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[plan/delegation] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
