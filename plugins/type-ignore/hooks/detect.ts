#!/usr/bin/env npx tsx

import { mkdirSync } from "node:fs";
import * as path from "node:path";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { EXTENSION_MAP, LANGUAGES, TARGET_EXTENSIONS } from "./languages";

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; old_string: string; new_string: string };

export interface PatternMatch {
  label: string;
  match: string;
}

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

function getLanguage(filePath: string): string | null {
  const ext = getExtension(filePath);
  return EXTENSION_MAP.get(ext) ?? null;
}

export function findIgnorePattern(content: string, language: string): PatternMatch | null {
  const config = LANGUAGES[language];
  if (!config) return null;
  for (const pattern of config.patterns) {
    const match = content.match(pattern.regex);
    if (match) {
      return { label: pattern.label, match: match[0] };
    }
  }
  return null;
}

export function hasNewIgnore(
  oldString: string,
  newString: string,
  language: string,
): PatternMatch | null {
  const newPattern = findIgnorePattern(newString, language);
  if (!newPattern) return null;

  const oldPattern = findIgnorePattern(oldString, language);
  if (oldPattern && newPattern.match === oldPattern.match) {
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

function getMarkerPath(sessionId: string): string {
  return path.join(MARKER_DIR, sessionId || "unknown");
}

export async function isCleanupAgentActive(sessionId: string): Promise<boolean> {
  const markerPath = getMarkerPath(sessionId);
  const file = Bun.file(markerPath);
  if (!(await file.exists())) return false;
  const age = Date.now() - file.lastModified;
  if (age > MARKER_TTL_MS) {
    await file.delete();
    return false;
  }
  return true;
}

async function setMarker(sessionId: string): Promise<void> {
  mkdirSync(MARKER_DIR, { recursive: true });
  await Bun.write(getMarkerPath(sessionId), String(Date.now()));
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

export async function processInput(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
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

  if (await isCleanupAgentActive(input.session_id)) {
    return null;
  }

  const pattern = hasNewIgnore(oldContent, newContent, language);
  if (!pattern) {
    return null;
  }

  const lineNumber = findLineNumber(newContent, pattern.match);

  await setMarker(input.session_id);

  return formatOutput(filePath, lineNumber, pattern.label);
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PostToolUseHookInput;
  } catch (error) {
    console.error(
      `[type-ignore] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
