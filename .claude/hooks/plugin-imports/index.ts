#!/usr/bin/env bun

import { join } from "node:path";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

interface TranscriptEntry {
  type?: string;
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: { file_path?: string };
    }>;
  };
}

export function extractPluginDir(filePath: string, projectDir: string): string | null {
  const prefix = `${join(projectDir, "plugins")}/`;
  if (!filePath.startsWith(prefix)) return null;

  const rest = filePath.slice(prefix.length);
  const pluginName = rest.split("/")[0];
  if (!pluginName) return null;

  return join(projectDir, "plugins", pluginName);
}

export async function getAffectedPlugins(
  input: StopHookInput,
  projectDir: string,
): Promise<string[]> {
  const transcriptPath = input.transcript_path;
  const file = Bun.file(transcriptPath);
  if (!(await file.exists())) return [];

  const content = await file.text();
  const pluginDirs = new Set<string>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.type !== "assistant" || !entry.message?.content) continue;

      for (const block of entry.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write") continue;

        const filePath = block.input?.file_path;
        if (!filePath?.endsWith(".ts")) continue;

        const pluginDir = extractPluginDir(filePath, projectDir);
        if (pluginDir) pluginDirs.add(pluginDir);
      }
    } catch {}
  }

  return [...pluginDirs];
}

export async function processInput(input: StopHookInput): Promise<SyncHookJSONOutput | null> {
  if (input.hook_event_name !== "Stop" || input.stop_hook_active) return null;

  const projectDir = input.cwd;
  const pluginDirs = await getAffectedPlugins(input, projectDir);
  if (pluginDirs.length === 0) return null;

  const scriptPath = join(import.meta.dirname, "..", "..", "scripts", "check-plugin-imports.ts");
  const proc = Bun.spawn(["bun", scriptPath, ...pluginDirs], {
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode === 0) return null;

  const stderr = await new Response(proc.stderr).text();

  return {
    decision: "block",
    reason: `Cross-plugin imports detected:\n\n${stderr}\n\nFix these imports before stopping. Plugins must not import from outside their own directory.`,
  };
}

async function main(): Promise<void> {
  let input: StopHookInput;
  try {
    input = await readStdinJson<StopHookInput>();
  } catch (error) {
    console.error(
      `[plugin-imports] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
