#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { stripRevised } from "./brief";
import { defaultStateRoot, PASSED_MARKER } from "./gate";

interface HookInput {
  session_id: string;
  tool_input: { planFilePath: string };
}

function isHookInput(value: unknown): value is HookInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "session_id" in value &&
    typeof value.session_id === "string" &&
    "tool_input" in value &&
    typeof value.tool_input === "object" &&
    value.tool_input !== null &&
    "planFilePath" in value.tool_input &&
    typeof value.tool_input.planFilePath === "string"
  );
}

// The approved plan reaches the implementer without the rejection history it answered.
export async function processInput(
  input: HookInput,
  stateRoot = defaultStateRoot(),
): Promise<void> {
  if (input.session_id !== "") {
    await rm(join(stateRoot, input.session_id, PASSED_MARKER), { force: true });
  }
  const path = input.tool_input.planFilePath;
  const plan = await Bun.file(path).text();
  const stripped = stripRevised(plan);
  if (stripped !== plan) await Bun.write(path, stripped);
}

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(await Bun.stdin.text());
  if (isHookInput(raw)) await processInput(raw);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[plan/strip] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
