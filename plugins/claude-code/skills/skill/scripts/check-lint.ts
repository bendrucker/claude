#!/usr/bin/env bun

import { basename, dirname } from "node:path";
import {
  type PostToolUseHookInput,
  postToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";
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
  input: PostToolUseHookInput,
  lintSkill: LintSkillFn = defaultLintSkill,
): Promise<SyncHookJSONOutput | null> {
  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || basename(filePath) !== "SKILL.md") return null;

  const messages = await lintMessages(dirname(filePath), lintSkill);
  if (messages.length === 0) return null;

  return postToolUse.additionalContext(
    `skill-lint found issues in ${filePath}:\n\n${messages.join("\n")}`,
  );
}

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>(processPostToolUse);
}
