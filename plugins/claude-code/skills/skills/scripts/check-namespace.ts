#!/usr/bin/env npx tsx

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readStdinJson } from "@constellos/claude-code-kit/runners";
import type { PostToolUseInput } from "@constellos/claude-code-kit";

export function extractPluginName(filePath: string): string | null {
  const match = filePath.match(/plugins\/([^/]+)\//);
  return match?.[1] ?? null;
}

export function getResourceType(filePath: string): "agent" | "command" | "skill" {
  if (/\/agents\/.*\.md$/.test(filePath)) return "agent";
  if (/\/commands\/.*\.md$/.test(filePath)) return "command";
  return "skill";
}

export function getResourceName(filePath: string, type: string): string | null {
  if (type === "agent" || type === "command") {
    return basename(filePath, ".md");
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^name:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export function checkStuttering(name: string, pluginName: string): string | null {
  const pluginPattern = pluginName.replace(/-/g, "[-_]");
  const regex = new RegExp(`^${pluginPattern}[-_]|[-_]${pluginPattern}$|^${pluginPattern}$`, "i");

  if (regex.test(name)) {
    return `'${name}' stutters with plugin namespace '${pluginName}'`;
  }
  return null;
}

export function processHookInput(input: PostToolUseInput): string[] {
  const warnings: string[] = [];

  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return warnings;
  const filePath = input.tool_input.file_path;
  if (!filePath) return warnings;

  const pluginName = extractPluginName(filePath);
  if (!pluginName) return warnings;

  const type = getResourceType(filePath);
  const name = getResourceName(filePath, type);
  if (!name) return warnings;

  const stutterWarning = checkStuttering(name, pluginName);
  if (stutterWarning) {
    warnings.push(`Warning: ${type} name ${stutterWarning}`);
    warnings.push(`  Qualified name would be: ${pluginName}:${name}`);
    warnings.push(
      `  Consider renaming to avoid repetition (e.g., ${pluginName}:${pluginName}-foo -> ${pluginName}:foo)`,
    );
  }

  return warnings;
}

async function main(): Promise<void> {
  let input: PostToolUseInput;
  try {
    input = await readStdinJson<PostToolUseInput>();
  } catch {
    return;
  }

  const warnings = processHookInput(input);
  for (const warning of warnings) {
    console.error(warning);
  }
}

main().catch(console.error);
