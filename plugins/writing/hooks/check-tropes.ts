#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { extractComments } from "../detection/comments";
import { isMemoryPath, isPlanPath, isProseFile } from "../detection/paths";
import {
  firstByTier,
  type PatternMatch,
  scan,
  scanIntroduced,
  semicolonSpliceHits,
} from "../detection/tropes";
import { formatContext, formatDecision, isPlanMode, type SyncHookJSONOutput } from "./io";

const FILE_OP_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

// The full set of Bash prose surfaces this hook scans. The hooks.json Bash
// guard is derived from these; hooks.test.ts enforces the sync.
export const PROSE_FLAGS = ["--body", "--message", "--description", "--title"] as const;
export const BODY_FILE_FLAG = "--body-file";

const BODY_FILE_PATTERN = new RegExp(`${BODY_FILE_FLAG}[=\\s](\\S+)`);

function extractBodyFilePath(command: string): string | null {
  const match = command.match(BODY_FILE_PATTERN);
  return match?.[1] ?? null;
}

const INLINE_ARG_PATTERNS = new Map<string, RegExp>(
  PROSE_FLAGS.map((flag) => [flag, new RegExp(`${flag}[= ](?:"([^"]+)"|'([^']+)')`)]),
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
    for (const flag of PROSE_FLAGS) {
      const value = extractInlineArg(toolInput.command, flag);
      if (value) texts.push(value);
    }
    return texts;
  }

  return [];
}

function isPlanFile(input: PreToolUseHookInput): boolean {
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  return isPlanPath(filePath);
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

// Comments are short, so density gates cannot work there: a single introduced
// splice fires. Diff-aware like scanIntroduced, comparing splice counts across
// the old and new comment text.
const COMMENT_SPLICE_MIN = 1;

function commentSplice(
  pair: { newText: string; oldText: string },
  filePath: string | undefined,
): string | null {
  if (!filePath || isProseFile(filePath)) return null;
  const newHits = semicolonSpliceHits(extractComments(pair.newText), COMMENT_SPLICE_MIN);
  if (newHits.count === 0) return null;
  const oldHits = semicolonSpliceHits(extractComments(pair.oldText), COMMENT_SPLICE_MIN);
  if (newHits.count <= oldHits.count) return null;
  return `A code comment splices clauses with a semicolon ("${newHits.sample}"). Comments can be fragments. Use a period or drop a word.`;
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

  const splice = commentSplice(pair, filePath);
  if (splice) return formatContext(splice);

  return null;
}

async function processSideEffect(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const texts = await collectText(input);
  if (texts.length === 0) return null;

  const matches = scan(texts.join("\n"), undefined, "sideEffect");
  const deny = firstByTier(matches, "deny");
  if (deny?.structural) return formatDecision("deny", deny.message);

  const match = deny ?? firstByTier(matches, "context");
  if (match) return formatContext(match.message);

  return null;
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  if (isPlanFile(input)) return null;
  if (isMemoryFile(input)) return null;
  if (isWordlistFile(input)) return null;
  if (isPlanMode(input)) return null;

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
