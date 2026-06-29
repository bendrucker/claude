#!/usr/bin/env bun

import { basename } from "node:path";
import { type PostToolUseHookInput, runHook } from "@bendrucker/claude-plugin-toolkit";

export function extractPluginName(filePath: string): string | null {
  const match = filePath.match(/plugins\/([^/]+)\//);
  return match?.[1] ?? null;
}

export function getResourceType(filePath: string): "agent" | "command" | "skill" {
  if (/\/agents\/.*\.md$/.test(filePath)) return "agent";
  if (/\/commands\/.*\.md$/.test(filePath)) return "command";
  return "skill";
}

export async function getResourceName(filePath: string, type: string): Promise<string | null> {
  if (type === "agent" || type === "command") {
    return basename(filePath, ".md");
  }

  try {
    const content = await Bun.file(filePath).text();
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

export function checkSkillNamespace(name: string, pluginName: string): string[] {
  const warnings: string[] = [];

  if (name === pluginName) return warnings;

  const prefix = `${pluginName}:`;
  if (!name.startsWith(prefix)) {
    warnings.push(
      `Warning: skill name '${name}' should be prefixed with '${prefix}' for disambiguation`,
    );
    warnings.push(`  Expected: '${prefix}${name}'`);
    return warnings;
  }

  const localName = name.slice(prefix.length);
  if (localName === pluginName) return warnings;

  const stutterWarning = checkStuttering(localName, pluginName);
  if (stutterWarning) {
    warnings.push(`Warning: skill name after prefix ${stutterWarning}`);
    warnings.push(
      `  Consider renaming to avoid repetition (e.g., ${prefix}${pluginName}-foo -> ${prefix}foo)`,
    );
  }

  return warnings;
}

export async function processHookInput(input: PostToolUseHookInput): Promise<string[]> {
  const warnings: string[] = [];

  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return warnings;
  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath) return warnings;

  const pluginName = extractPluginName(filePath);
  if (!pluginName) return warnings;

  const type = getResourceType(filePath);
  const name = await getResourceName(filePath, type);
  if (!name) return warnings;

  if (type === "skill") {
    return checkSkillNamespace(name, pluginName);
  }

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

if (import.meta.main) {
  runHook<PostToolUseHookInput, never>(async (input) => {
    for (const warning of await processHookInput(input)) {
      console.error(warning);
    }
    return null;
  });
}
