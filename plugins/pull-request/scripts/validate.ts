#!/usr/bin/env bun

// oxlint-disable-next-line no-restricted-imports -- Bun has no rename, and only a rename replaces the file atomically.
import { rename } from "node:fs/promises";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type BodyContext, decide, headingCaseCorrection, scanBody } from "./body-rules";
import type { HeadingCaseViolation } from "./heading-case";
import { gitRepo } from "./repo";
import { effectiveCwd, extractTitle, isPrBodyCommand, resolveBody } from "./resolve-body";
import { splice } from "./shell";

const BashInput = z.looseObject({ command: z.string() });

export const HookInput = z.looseObject({
  cwd: z.string().optional(),
  tool_input: z.unknown(),
});
export type HookInput = z.infer<typeof HookInput>;

function headingChanges(headings: HeadingCaseViolation[]): string {
  return headings.map((heading) => `"${heading.text}" → "${heading.suggested}"`).join("; ");
}

function correctionNote(file: string, headings: HeadingCaseViolation[]): string {
  return `Section headings in \`${file}\` were re-cased to AP title case in place before this command ran: ${headingChanges(headings)}. Only letter case changed. The pairs above are display text, so any emphasis, link, or image the heading carries is missing from them and still in the file. Re-read the file before editing it.`;
}

function heredocCorrectionNote(headings: HeadingCaseViolation[]): string {
  return `Section headings in the same-call heredoc were re-cased to AP title case before this command ran: ${headingChanges(headings)}. Only letter case changed. No file backs this body, so the correction is already in the command that is about to run.`;
}

/**
 * Replaces the file's contents, reporting whether it landed. The correction is
 * written to a sibling and renamed over the source, so an interrupted or failed
 * write leaves the author's body whole rather than truncated. The sibling
 * shares the source's directory, and so its filesystem, which is what makes the
 * rename atomic.
 */
async function replaceFile(file: string, text: string): Promise<boolean> {
  const temp = `${file}.${process.pid}.hook`;
  try {
    await Bun.write(temp, text);
    await rename(temp, file);
    return true;
  } catch {
    await Bun.file(temp)
      .delete()
      .catch(() => undefined);
    return false;
  }
}

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  const toolInput = BashInput.safeParse(input.tool_input).data;
  const command = toolInput?.command;
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
  if (file !== null) {
    const correction = headingCaseCorrection(body, matches);
    if (correction === null) return decide(matches);
    if (!(await replaceFile(file, correction.body))) return decide(matches);
    return decide(
      matches.filter((match) => match.id !== "heading-case"),
      correctionNote(file, correction.headings),
    );
  }

  // No file backs the body: the command's own heredoc is the sole source, and
  // no `gh`/`glab` call has read it yet, so a correction can only reach the PR
  // by rewriting the command that is about to run.
  const heredoc = resolved.kind === "text" ? resolved.heredoc : null;
  if (heredoc !== null) {
    const correction = headingCaseCorrection(body, matches);
    if (correction !== null) {
      return decide(
        matches.filter((match) => match.id !== "heading-case"),
        heredocCorrectionNote(correction.headings),
        // updatedInput replaces the whole tool_input object, so every field
        // Claude sent rides along and only `command` changes.
        { ...toolInput, command: splice(command, heredoc.span, correction.body) },
      );
    }
  }
  return decide(matches);
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
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Unexpected error: ${message}`);
    denyWithError(`Validation hook encountered an error: ${message}`);
  });
}
