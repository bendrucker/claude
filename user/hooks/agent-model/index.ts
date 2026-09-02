#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";
import { type ModelFamily, modelFamily } from "../../scripts/model";

const AgentInput = z.looseObject({
  subagent_type: z.string().optional(),
  model: z.string().optional(),
});

// Types that name no model of their own, so the spawn site has to supply one.
// Every other type either pins a model in its definition or is a deliberate
// choice the parent already made.
const UNPINNED_TYPES = new Set(["general-purpose"]);

const EXPENSIVE_FAMILIES = new Set<ModelFamily>(["opus", "fable"]);

// PreToolUse carries no model field, so the parent's model comes from the last
// assistant record in the session transcript. Sidechain turns live in their own
// `agent-*.jsonl`, so the tail of this file is the parent's own turn: the one
// that just emitted this spawn.
const TAIL_BYTES = 128 * 1024;

const TranscriptRecord = z.looseObject({
  type: z.string().optional(),
  message: z.looseObject({ model: z.string().optional() }).optional(),
});

export function parseParentFamily(tail: string): ModelFamily | null {
  const lines = tail.split("\n");
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at];
    if (line === undefined || line === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = TranscriptRecord.safeParse(parsed).data;
    if (record?.type !== "assistant") continue;
    const family = modelFamily(record.message?.model);
    if (family !== null) return family;
  }

  return null;
}

export async function parentFamily(
  transcriptPath: string | undefined,
): Promise<ModelFamily | null> {
  if (transcriptPath === undefined || transcriptPath === "") return null;
  try {
    const file = Bun.file(transcriptPath);
    return parseParentFamily(await file.slice(Math.max(0, file.size - TAIL_BYTES)).text());
  } catch {
    return null;
  }
}

export function warning(family: ModelFamily): string {
  return [
    `This Agent spawn sets no \`model\` and no \`subagent_type\` that pins one, so it inherits the parent's ${family} and bills the whole subagent at orchestrator rates.`,
    "CLAUDE.md: pick a spawn's `subagent_type` before its `model`, and pass an explicit cheap `model` when the type names none.",
    'Either set `subagent_type` to `analyst` (read-only research, search, judging) or another type whose `bun run inventory agents` row names a model, or pass `model: "haiku"` or `model: "sonnet"`.',
  ].join("\n\n");
}

export function processInput(
  input: HookInput,
  family: ModelFamily | null,
): SyncHookJSONOutput | null {
  if (family === null || !EXPENSIVE_FAMILIES.has(family)) return null;

  const agent = AgentInput.safeParse(input.tool_input).data;
  if (agent === undefined) return null;
  if (agent.model !== undefined) return null;
  if (agent.subagent_type !== undefined && !UNPINNED_TYPES.has(agent.subagent_type)) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: warning(family),
    },
  };
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = await readHookInput("agent-model");
  } catch (error) {
    console.error(
      `[agent-model] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await timeHook("agent-model", input, async () =>
    processInput(input, await parentFamily(input.transcript_path)),
  );
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
