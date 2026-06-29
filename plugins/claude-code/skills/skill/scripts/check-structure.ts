#!/usr/bin/env bun

import { relative } from "node:path";
import { type PostToolUseHookInput, runHook } from "@bendrucker/claude-plugin-toolkit";

const SPEC_URL = "https://agentskills.io/specification#optional-directories";

const ALLOWED_DIRECTORIES = ["scripts", "references", "assets"] as const;

const SKILL_MD = "SKILL.md";

export function extractSkillRoot(filePath: string): string | null {
  const patterns = [/(.+\/skills\/[^/]+)\//, /(.+\/commands)\//];

  for (const pattern of patterns) {
    const match = filePath.match(pattern);
    if (match) return match[1] ?? null;
  }

  return null;
}

export function validateSkillPath(filePath: string, skillRoot: string): string | null {
  const rel = relative(skillRoot, filePath);

  if (rel === SKILL_MD) return null;

  const topDir = rel.split("/")[0];
  if (ALLOWED_DIRECTORIES.includes(topDir as (typeof ALLOWED_DIRECTORIES)[number])) {
    return null;
  }

  const allowed = [SKILL_MD, ...ALLOWED_DIRECTORIES.map((d) => `${d}/`)].join(", ");
  return `'${rel}' is outside the standard skill structure. Allowed paths: ${allowed}. See ${SPEC_URL}`;
}

export function processHookInput(input: PostToolUseHookInput): string[] {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return [];

  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath) return [];

  const skillRoot = extractSkillRoot(filePath);
  if (!skillRoot) return [];

  const warning = validateSkillPath(filePath, skillRoot);
  return warning ? [warning] : [];
}

if (import.meta.main) {
  runHook<PostToolUseHookInput, never>((input) => {
    for (const warning of processHookInput(input)) {
      console.error(warning);
    }
    return null;
  });
}
