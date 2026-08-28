#!/usr/bin/env bun

import { relative } from "node:path";
import { filePathOf, HookInput } from "./hook-input";

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
  if (ALLOWED_DIRECTORIES.some((dir) => dir === topDir)) return null;

  const allowed = [SKILL_MD, ...ALLOWED_DIRECTORIES.map((d) => `${d}/`)].join(", ");
  return `'${rel}' is outside the standard skill structure. Allowed paths: ${allowed}. See ${SPEC_URL}`;
}

export function processHookInput(input: HookInput): string[] {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return [];

  const filePath = filePathOf(input.tool_input);
  if (!filePath) return [];

  const skillRoot = extractSkillRoot(filePath);
  if (!skillRoot) return [];

  const warning = validateSkillPath(filePath, skillRoot);
  return warning ? [warning] : [];
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch {
    return;
  }

  const warnings = processHookInput(input);
  for (const warning of warnings) {
    console.error(warning);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
