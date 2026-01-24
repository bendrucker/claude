#!/usr/bin/env npx tsx

import * as fs from "node:fs";
import * as path from "node:path";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; old_string: string; new_string: string };

const TARGET_EXTENSIONS = new Set(["ts", "tsx", "py"]);

const IGNORE_PATTERNS: Record<string, RegExp[]> = {
  typescript: [/@ts-ignore/, /@ts-expect-error/, /eslint-disable(?:-next-line)?/],
  python: [/#\s*type:\s*ignore/, /#\s*noqa/],
};

const MARKER_DIR = "/tmp/claude/type-ignore-active";
const MARKER_TTL_MS = 10 * 60 * 1000;

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function isTargetFile(filePath: string): boolean {
  const ext = getExtension(filePath);
  return TARGET_EXTENSIONS.has(ext);
}

function getLanguage(filePath: string): "typescript" | "python" | null {
  const ext = getExtension(filePath);
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "py") return "python";
  return null;
}

export function findIgnorePattern(
  content: string,
  language: "typescript" | "python",
): string | null {
  const patterns = IGNORE_PATTERNS[language];
  if (!patterns) return null;
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

export function hasNewIgnore(
  oldString: string,
  newString: string,
  language: "typescript" | "python",
): string | null {
  const newPattern = findIgnorePattern(newString, language);
  if (!newPattern) return null;

  const oldPattern = findIgnorePattern(oldString, language);
  if (oldPattern && newPattern === oldPattern) {
    return null;
  }

  return newPattern;
}

export function findLineNumber(content: string, pattern: string): number {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(pattern)) {
      return i + 1;
    }
  }
  return 1;
}

function getSessionId(): string {
  return process.env.CLAUDE_SESSION_ID || "unknown";
}

function getMarkerPath(): string {
  return path.join(MARKER_DIR, getSessionId());
}

export function isCleanupAgentActive(): boolean {
  const markerPath = getMarkerPath();
  try {
    const stats = fs.statSync(markerPath);
    const age = Date.now() - stats.mtimeMs;
    if (age > MARKER_TTL_MS) {
      fs.unlinkSync(markerPath);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function setMarker(): void {
  fs.mkdirSync(MARKER_DIR, { recursive: true });
  fs.writeFileSync(getMarkerPath(), String(Date.now()));
}

export function formatOutput(
  filePath: string,
  lineNumber: number,
  pattern: string,
): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `Type ignore added in ${filePath}:${lineNumber} (${pattern}). Spawn type-ignore:fixer agent in background to fix ONLY this specific ignore, not other ignores in the file.`,
    },
  };
}

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const toolName = input.tool_name;

  let filePath: string;
  let newContent: string;
  let oldContent = "";

  if (toolName === "Write") {
    const writeInput = input.tool_input as WriteInput;
    filePath = writeInput.file_path;
    newContent = writeInput.content;
  } else if (toolName === "Edit") {
    const editInput = input.tool_input as EditInput;
    filePath = editInput.file_path;
    oldContent = editInput.old_string;
    newContent = editInput.new_string;
  } else {
    return null;
  }

  if (!isTargetFile(filePath)) {
    return null;
  }

  const language = getLanguage(filePath);
  if (!language) {
    return null;
  }

  if (isCleanupAgentActive()) {
    return null;
  }

  const pattern = hasNewIgnore(oldContent, newContent, language);
  if (!pattern) {
    return null;
  }

  const lineNumber = findLineNumber(newContent, pattern);

  setMarker();

  return formatOutput(filePath, lineNumber, pattern);
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = await readStdinJson<PostToolUseHookInput>();
  } catch (error) {
    console.error(
      `[type-ignore] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
