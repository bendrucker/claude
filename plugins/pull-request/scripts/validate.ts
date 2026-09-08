#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type BodyContext, decide, headingCaseCorrection, scanBody } from "./body-rules";
import type { HeadingCaseViolation } from "./heading-case";
import { gitRepo } from "./repo";
import { effectiveCwd, extractTitle, isPrBodyCommand, resolveBody } from "./resolve-body";

const BashInput = z.looseObject({ command: z.string() });

export const HookInput = z.looseObject({
  cwd: z.string().optional(),
  tool_input: z.unknown(),
});
export type HookInput = z.infer<typeof HookInput>;

function correctionNote(file: string, headings: HeadingCaseViolation[]): string {
  const changes = headings
    .map((heading) => `"${heading.text}" → "${heading.suggested}"`)
    .join("; ");
  return `Section headings in \`${file}\` were re-cased to AP title case before this command ran: ${changes}. Nothing else in the body changed. Carry the corrected headings into any later edit of it.`;
}

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  const command = BashInput.safeParse(input.tool_input).data?.command;
  if (command === undefined || !isPrBodyCommand(command)) {
    return null;
  }
  const cwd = input.cwd ?? process.cwd();
  const resolved = await resolveBody(command, cwd);
  const body = resolved.kind === "text" ? resolved.text : "";
  const context: Partial<BodyContext> = {
    title: extractTitle(command),
    unreadable: resolved.kind === "unreadable" ? resolved.detail : null,
    ...gitRepo(effectiveCwd(command, cwd)),
  };
  const matches = await scanBody(body, context);

  const file = resolved.kind === "text" ? resolved.file : null;
  if (file === null) return decide(matches);
  const correction = headingCaseCorrection(body, matches);
  if (correction === null) return decide(matches);
  try {
    await Bun.write(file, correction.body);
  } catch {
    return decide(matches);
  }
  return decide(
    matches.filter((match) => match.id !== "heading-case"),
    correctionNote(file, correction.headings),
  );
}

function denyWithError(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } satisfies SyncHookJSONOutput;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Failed to parse hook input: ${message}`);
    denyWithError(`Validation hook failed to parse input: ${message}`);
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Unexpected error: ${message}`);
    denyWithError(`Validation hook encountered an error: ${message}`);
  });
}
