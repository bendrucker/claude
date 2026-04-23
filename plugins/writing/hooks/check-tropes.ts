#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { formatContext, formatDecision, type SyncHookJSONOutput } from "./markdown";
import { firstByTier, scan } from "./tropes";

const MIN_PROSE_LENGTH = 20;

const SKIPPED_KEYS = new Set([
  "old_string",
  "oldstring",
  "old_str",
  "pattern",
  "match",
  "search",
  "search_query",
  "query",
]);

function shouldSkipKey(key: string | undefined): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (SKIPPED_KEYS.has(lower)) return true;
  return lower.startsWith("old_");
}

function isProse(value: string): boolean {
  if (value.length < MIN_PROSE_LENGTH) return false;
  if (/^https?:\/\//.test(value)) return false;
  if (/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return /\s/.test(value);
}

function extractProse(value: unknown, key?: string): string[] {
  if (shouldSkipKey(key)) return [];
  if (typeof value === "string") return isProse(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => extractProse(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([childKey, childValue]) =>
      extractProse(childValue, childKey),
    );
  }
  return [];
}

function extractBodyFilePath(command: string): string | null {
  const match = command.match(/--body-file[=\s](\S+)/);
  return match?.[1] ?? null;
}

const INLINE_ARG_PATTERNS = new Map(
  ["--body", "--message", "--description", "--title"].map(
    (flag) => [flag, new RegExp(`${flag}[= ](?:"([^"]+)"|'([^']+)')`)] as const,
  ),
);

function extractInlineArg(command: string, flag: string): string | null {
  const pattern = INLINE_ARG_PATTERNS.get(flag);
  if (!pattern) return null;
  const match = pattern.exec(command);
  return match?.[1] ?? match?.[2] ?? null;
}

function collectMultiEditText(toolInput: Record<string, unknown>): string[] {
  const edits = toolInput.edits;
  if (!Array.isArray(edits)) return [];
  const texts: string[] = [];
  for (const edit of edits) {
    if (edit && typeof edit === "object") {
      const newString = (edit as Record<string, unknown>).new_string;
      if (typeof newString === "string") texts.push(newString);
    }
  }
  return texts;
}

export async function collectText(input: PreToolUseHookInput): Promise<string[]> {
  const toolInput = input.tool_input as Record<string, unknown>;
  const toolName = input.tool_name;

  if (toolName === "Write") {
    const content = toolInput.content as string | undefined;
    return content ? [content] : [];
  }

  if (toolName === "Edit") {
    const content = toolInput.new_string as string | undefined;
    return content ? [content] : [];
  }

  if (toolName === "MultiEdit") {
    return collectMultiEditText(toolInput);
  }

  if (toolName === "Bash" && typeof toolInput.command === "string") {
    const texts: string[] = [];
    const bodyFile = extractBodyFilePath(toolInput.command);
    if (bodyFile && (await Bun.file(bodyFile).exists())) {
      texts.push(await Bun.file(bodyFile).text());
    }
    for (const flag of ["--body", "--message", "--description", "--title"]) {
      const value = extractInlineArg(toolInput.command, flag);
      if (value) texts.push(value);
    }
    return texts;
  }

  return extractProse(toolInput);
}

function isPlanFile(input: PreToolUseHookInput): boolean {
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  const home = process.env.HOME ?? "";
  return home !== "" && filePath.startsWith(`${home}/.claude/plans/`);
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  if (isPlanFile(input)) return null;

  const texts = await collectText(input);
  if (texts.length === 0) return null;

  const combined = texts.join("\n");
  const filePath = (input.tool_input as Record<string, unknown>).file_path as string | undefined;
  const matches = scan(combined, filePath);
  const deny = firstByTier(matches, "deny");

  if (deny) {
    if (input.tool_name === "Edit" || input.tool_name === "MultiEdit") {
      return formatDecision("ask", deny.message);
    }
    return formatDecision("deny", deny.message);
  }

  const context = firstByTier(matches, "context");
  if (context) {
    return formatContext(context.message);
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[writing/tropes] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
