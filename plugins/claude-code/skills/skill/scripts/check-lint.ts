#!/usr/bin/env bun

import { basename, dirname } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { filePathOf, HookInput } from "./hook-input";
import { lintSkill as defaultLintSkill } from "./skill-lint";
import type { SkillLintResult } from "./skill-lint/types";

type LintSkillFn = (dir: string) => SkillLintResult | Promise<SkillLintResult>;

async function lintMessages(skillDir: string, lintSkill: LintSkillFn): Promise<string[]> {
  const result = await lintSkill(skillDir);
  if (result.errors === 0 && result.warnings === 0) return [];

  const messages: string[] = [];
  for (const r of result.results) {
    if (r.passed) continue;
    messages.push(`[${r.severity}] ${r.rule}: ${r.message}`);
  }
  return messages;
}

export async function processPostToolUse(
  input: HookInput,
  lintSkill: LintSkillFn = defaultLintSkill,
): Promise<SyncHookJSONOutput | null> {
  const filePath = filePathOf(input.tool_input);
  if (!filePath || basename(filePath) !== "SKILL.md") return null;

  const messages = await lintMessages(dirname(filePath), lintSkill);
  if (messages.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `skill-lint found issues in ${filePath}:\n\n${messages.join("\n")}`,
    },
  };
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[skill-lint] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processPostToolUse(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
