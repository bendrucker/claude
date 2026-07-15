#!/usr/bin/env bun

import { extname } from "node:path";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

import { validate } from "./validate";

export function isSvgFile(filePath: string): boolean {
  return extname(filePath) === ".svg";
}

function formatOutput(additionalContext: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  };
}

export async function processInput(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
    return null;
  }

  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || !isSvgFile(filePath)) {
    return null;
  }

  const content = await Bun.file(filePath).text();
  const violations = validate(content);

  if (violations.length === 0) {
    return null;
  }

  const details = violations.map((v) => `- ${v.element}: ${v.issue}\n  ${v.details}`).join("\n");

  return formatOutput(`Wireframe validation found ${violations.length} issue(s) in ${filePath}:

${details}

Fix these layout issues before rendering.`);
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PostToolUseHookInput;
  } catch {
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
