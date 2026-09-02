#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";
import { type ModelFamily, modelFamily } from "../../scripts/model";
import { readTranscriptTail } from "../../scripts/transcript";

const AgentInput = z.looseObject({
  subagent_type: z.string().optional(),
  model: z.string().optional(),
});

// Types that name no model of their own, so the spawn site has to supply one.
// Every other type either pins a model in its definition or is a deliberate
// choice the parent already made.
const UNPINNED_TYPES = new Set(["general-purpose"]);

const EXPENSIVE_FAMILIES = new Set<ModelFamily>(["opus", "fable"]);

// PreToolUse carries no model field, so the parent's model comes from the
// newest transcript record carrying one, which is its last assistant turn.
// Sidechain turns live in their own `agent-*.jsonl`, so that turn is the
// parent's own: the one that just emitted this spawn. The window has to clear a
// single large turn, because a record starting before it leaves nothing
// parsable behind it.
const TAIL_BYTES = 512 * 1024;

const TranscriptRecord = z.looseObject({
  message: z.looseObject({ model: z.string().optional() }).optional(),
});

// The newest record carrying a model decides, whether or not its family is one
// we know. Falling through to an older turn would report the family the session
// was on before a `/model` switch.
export function latestFamily(entries: unknown[]): ModelFamily | null {
  for (let at = entries.length - 1; at >= 0; at--) {
    const model = TranscriptRecord.safeParse(entries[at]).data?.message?.model;
    if (model !== undefined && model !== "") return modelFamily(model);
  }
  return null;
}

export async function parentFamily(
  transcriptPath: string | undefined,
): Promise<ModelFamily | null> {
  if (transcriptPath === undefined || transcriptPath === "") return null;
  return latestFamily(await readTranscriptTail(transcriptPath, TAIL_BYTES));
}

export function spawnNeedsModel(toolInput: unknown): boolean {
  const agent = AgentInput.safeParse(toolInput).data;
  if (agent === undefined) return false;
  if (agent.model !== undefined && agent.model !== "") return false;
  return agent.subagent_type === undefined || UNPINNED_TYPES.has(agent.subagent_type);
}

export function warning(family: ModelFamily): string {
  return [
    `This Agent spawn sets no \`model\` and no \`subagent_type\` that pins one, so it inherits the parent's ${family} and bills the whole subagent at orchestrator rates.`,
    "CLAUDE.md: pick a spawn's `subagent_type` before its `model`, and pass an explicit cheap `model` when the type names none.",
    'Either set `subagent_type` to `analyst` (read-only research, search, judging) or another type whose `bun run inventory agents` row names a model, or pass `model: "haiku"` or `model: "sonnet"`.',
  ].join("\n\n");
}

// The tool input decides first so a spawn that already names a model or a
// pinned type costs no transcript read. That is most of them.
export async function decide(
  input: HookInput,
  resolveFamily: () => Promise<ModelFamily | null>,
): Promise<SyncHookJSONOutput | null> {
  if (!spawnNeedsModel(input.tool_input)) return null;

  const family = await resolveFamily();
  if (family === null || !EXPENSIVE_FAMILIES.has(family)) return null;

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

  const output = await timeHook("agent-model", input, () =>
    decide(input, () => parentFamily(input.transcript_path)),
  );
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
