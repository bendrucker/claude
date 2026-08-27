#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const FileInput = z.looseObject({ file_path: z.string().optional().catch(undefined) });
export type FileInput = z.infer<typeof FileInput>;

export const HookInput = z.looseObject({ tool_input: z.unknown() });
export type HookInput = z.infer<typeof HookInput>;

const GENERATED_MARKER = /^\/\/\s*Code\s+generated.*DO\s+NOT\s+EDIT\.$/;

export function isGeneratedFile(content: string): boolean {
  const lines = content.split("\n");
  let foundMarker = false;
  let foundCode = false;

  for (const line of lines) {
    if (/^\s*$/.test(line)) {
      continue;
    }

    if (GENERATED_MARKER.test(line)) {
      foundMarker = true;
      continue;
    }

    if (line.startsWith("//") || line.startsWith("/*")) {
      continue;
    }

    // Found non-comment, non-blank text
    foundCode = true;
    break;
  }

  return foundMarker && foundCode;
}

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  const filePath = FileInput.safeParse(input.tool_input).data?.file_path;

  if (filePath == null || filePath === "" || !filePath.endsWith(".go")) {
    return null;
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();

  if (isGeneratedFile(content)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Cannot modify generated Go file: ${filePath}`,
      },
    };
  }

  return null;
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[go/check] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
