#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { formatContext, formatDecision, isMemoryPath, type SyncHookJSONOutput } from "./markdown";
import { firstByTier, type PatternMatch, type ScanContext, scan, scanIntroduced } from "./tropes";

const FILE_OP_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

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

type ProseEntry = { key: string | undefined; value: string };

function extractProseEntries(value: unknown, key?: string): ProseEntry[] {
  if (shouldSkipKey(key)) return [];
  if (typeof value === "string") return isProse(value) ? [{ key, value }] : [];
  if (Array.isArray(value)) return value.flatMap((item) => extractProseEntries(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([childKey, childValue]) =>
      extractProseEntries(childValue, childKey),
    );
  }
  return [];
}

function extractProse(value: unknown, key?: string): string[] {
  return extractProseEntries(value, key).map((entry) => entry.value);
}

const PROSE_TOOL_PATTERN =
  /\b(?:issue|ticket|story|epic|document|doc|page|wiki|note|comment|message|post|reply|thread|discussion|review|article|memo)\b/;

const PROSE_KEY_PATTERN =
  /\b(?:description|body|content|text|title|summary|comment|message|note|details)\b/;

function tokenize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isProseTool(toolName: string): boolean {
  return PROSE_TOOL_PATTERN.test(tokenize(toolName));
}

function isProseKey(key: string | undefined): boolean {
  return key !== undefined && PROSE_KEY_PATTERN.test(tokenize(key));
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

function collectMultiEditPairs(toolInput: Record<string, unknown>): {
  newText: string;
  oldText: string;
} {
  const edits = toolInput.edits;
  if (!Array.isArray(edits)) return { newText: "", oldText: "" };
  const newParts: string[] = [];
  const oldParts: string[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") continue;
    const fields = edit as Record<string, unknown>;
    if (typeof fields.new_string === "string") newParts.push(fields.new_string);
    if (typeof fields.old_string === "string") oldParts.push(fields.old_string);
  }
  return { newText: newParts.join("\n"), oldText: oldParts.join("\n") };
}

async function collectFileOpPair(
  input: PreToolUseHookInput,
): Promise<{ newText: string; oldText: string } | null> {
  const toolInput = input.tool_input as Record<string, unknown>;
  const toolName = input.tool_name;

  if (toolName === "Write") {
    const content = toolInput.content;
    if (typeof content !== "string" || content.length === 0) return null;
    const filePath = toolInput.file_path;
    let oldText = "";
    if (typeof filePath === "string") {
      const file = Bun.file(filePath);
      if (await file.exists()) oldText = await file.text();
    }
    return { newText: content, oldText };
  }

  if (toolName === "Edit") {
    const newString = toolInput.new_string;
    if (typeof newString !== "string" || newString.length === 0) return null;
    const oldString = toolInput.old_string;
    return { newText: newString, oldText: typeof oldString === "string" ? oldString : "" };
  }

  if (toolName === "MultiEdit") {
    const pair = collectMultiEditPairs(toolInput);
    if (pair.newText.length === 0) return null;
    return pair;
  }

  return null;
}

export async function collectText(input: PreToolUseHookInput): Promise<string[]> {
  const toolInput = input.tool_input as Record<string, unknown>;
  const toolName = input.tool_name;

  if (FILE_OP_TOOLS.has(toolName)) {
    const pair = await collectFileOpPair(input);
    return pair ? [pair.newText] : [];
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

async function collectLexicalText(input: PreToolUseHookInput): Promise<string[]> {
  const toolName = input.tool_name;

  if (toolName === "Bash") return collectText(input);

  const toolInput = input.tool_input as Record<string, unknown>;
  const entries = extractProseEntries(toolInput);
  if (isProseTool(toolName)) return entries.map((entry) => entry.value);
  return entries.filter((entry) => isProseKey(entry.key)).map((entry) => entry.value);
}

function isPlanFile(input: PreToolUseHookInput): boolean {
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  const home = process.env.HOME ?? "";
  return home !== "" && filePath.startsWith(`${home}/.claude/plans/`);
}

function isMemoryFile(input: PreToolUseHookInput): boolean {
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  return isMemoryPath(filePath);
}

const WORDLIST_PATH_PATTERN = /\/wordlists\/[^/]+\.txt$/;

function isWordlistFile(input: PreToolUseHookInput): boolean {
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  return WORDLIST_PATH_PATTERN.test(filePath);
}

function buildFileOpReminder(
  toolName: string,
  filePath: string | undefined,
  deny: PatternMatch,
): string {
  const target = filePath ? `\`${filePath}\`` : "the file";
  if (toolName === "Write") {
    return `${deny.message} You wrote ${target} introducing this. Issue a follow-up Edit that fixes only the trope you just introduced. Do not modify unrelated parts of the file.`;
  }
  return `${deny.message} You introduced this in your edit to ${target}. Issue a follow-up Edit that targets only the text you just changed. Do not modify unrelated parts of the file, including other pre-existing tropes.`;
}

async function processFileOp(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const pair = await collectFileOpPair(input);
  if (!pair) return null;
  const filePath = (input.tool_input as Record<string, unknown>).file_path as string | undefined;
  const matches = scanIntroduced(pair.newText, pair.oldText, filePath, "file");

  const deny = firstByTier(matches, "deny");
  if (deny) {
    return formatContext(buildFileOpReminder(input.tool_name, filePath, deny));
  }

  const context = firstByTier(matches, "context");
  if (context) return formatContext(context.message);

  return null;
}

async function processSideEffect(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const texts = await collectText(input);
  if (texts.length === 0) return null;

  const structural = firstByTier(scan(texts.join("\n"), undefined, "sideEffect"), "deny");
  if (structural?.structural) return formatDecision("deny", structural.message);

  const lexical = await collectLexicalText(input);
  if (lexical.length === 0) return null;
  const matches = scan(lexical.join("\n"), undefined, "sideEffect");
  const match = firstByTier(matches, "deny") ?? firstByTier(matches, "context");
  if (match) return formatContext(match.message);

  return null;
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  if (isPlanFile(input)) return null;
  if (isMemoryFile(input)) return null;
  if (isWordlistFile(input)) return null;

  if (FILE_OP_TOOLS.has(input.tool_name)) return processFileOp(input);
  return processSideEffect(input);
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
