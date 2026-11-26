#!/usr/bin/env bun

// Holds a drafted PR body file to the structure limits as soon as it is
// written. An over-limit draft gets cut before anyone reviews it.

import { basename } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { exceededLimits, limitsReason, measureStructure } from "./structure";
import { eventsRoot, recordValidation } from "./validation-events";

export const DraftInput = z.looseObject({
  session_id: z.string().optional(),
  tool_input: z.looseObject({ file_path: z.string() }),
});
export type DraftInput = z.infer<typeof DraftInput>;

const DRAFT_NAME = /^pr-body.*\.md$/;

export async function checkDraft(
  input: DraftInput,
  events: string = eventsRoot(),
): Promise<SyncHookJSONOutput | null> {
  const file = input.tool_input.file_path;
  if (!DRAFT_NAME.test(basename(file))) return null;
  const draft = Bun.file(file);
  if (!(await draft.exists())) return null;
  const structure = measureStructure(await draft.text());
  const exceeded = exceededLimits(structure);
  if (input.session_id !== undefined) {
    const rules = exceeded.length > 0 ? ["structure-limits"] : [];
    await recordValidation(
      { sessionId: input.session_id, verb: "draft", rules, structure },
      events,
    );
  }
  if (exceeded.length === 0) return null;
  return {
    decision: "block",
    reason: `The PR body draft in \`${file}\` would be denied at create or edit. Cut it before anyone reviews it. ${limitsReason(exceeded)}`,
  };
}

async function main(): Promise<void> {
  const parsed = DraftInput.safeParse(JSON.parse(await Bun.stdin.text()));
  if (!parsed.success) return;
  const output = await checkDraft(parsed.data);
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[pull-request/check-draft] ${String(error)}`);
  });
}
