#!/usr/bin/env npx tsx

import { execSync } from "node:child_process";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-code";

export type WriteInput = { file_path: string };
export type EditInput = { file_path: string };

const BIOME_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "json", "jsonc"]);

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function isBiomeFile(filePath: string): boolean {
  const ext = getExtension(filePath);
  return BIOME_EXTENSIONS.has(ext);
}

function hasBiome(): boolean {
  try {
    execSync("command -v biome", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function runBiome(filePath: string): string | null {
  try {
    execSync(`biome check "${filePath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return null;
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const output = (execError.stdout || "") + (execError.stderr || "");
    return output.trim() || null;
  }
}

export function formatOutput(additionalContext: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  };
}

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const toolName = input.tool_name;

  let filePath: string;
  if (toolName === "Write") {
    filePath = (input.tool_input as WriteInput).file_path;
  } else if (toolName === "Edit") {
    filePath = (input.tool_input as EditInput).file_path;
  } else {
    return null;
  }

  if (!isBiomeFile(filePath)) {
    return null;
  }

  if (!hasBiome()) {
    return null;
  }

  const errors = runBiome(filePath);
  if (!errors) {
    return null;
  }

  return formatOutput(`Biome found issues in ${filePath}:

${errors}

Fix these issues before continuing.`);
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = await readStdinJson<PostToolUseHookInput>();
  } catch (error) {
    console.error(
      `[biome] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
