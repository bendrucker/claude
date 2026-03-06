#!/usr/bin/env bun

import { basename, dirname } from "node:path";
import type { PostToolUseHookOutput, PostToolUseInput } from "@constellos/claude-code-kit";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { lintSkill } from "./skill-lint";

function lintMessages(skillDir: string): string[] {
  const result = lintSkill(skillDir);
  if (result.errors === 0 && result.warnings === 0) return [];

  const messages: string[] = [];
  for (const r of result.results) {
    if (r.passed) continue;
    messages.push(`[${r.severity}] ${r.rule}: ${r.message}`);
  }
  return messages;
}

export function processPostToolUse(input: PostToolUseInput): PostToolUseHookOutput | null {
  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || basename(filePath) !== "SKILL.md") return null;

  const messages = lintMessages(dirname(filePath));
  if (messages.length === 0) return null;

  return {
    decision: undefined,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `skill-lint found issues in ${filePath}:\n\n${messages.join("\n")}`,
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseInput;
  try {
    input = await readStdinJson<PostToolUseInput>();
  } catch (error) {
    console.error(
      `[skill-lint] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processPostToolUse(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
