#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import {
  type EditInput,
  extractMarkdownFromBash,
  extractMarkdownFromMcp,
  formatContext,
  getExtension,
  hasBashCommand,
  isMarkdownFile,
  type SyncHookJSONOutput,
  type WriteInput,
} from "./markdown";

const CONTEXT_MESSAGE =
  "Do not summarize by counting items (e.g. 'Added 5 tests', '3 new endpoints'). " +
  "Either list the items individually or provide a qualitative summary of what was added and why it matters.";

function markerPath(sessionId: string, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return join(tmpdir(), `style-counts-${sessionId}-${hash}`);
}

function alreadyInjected(sessionId: string, key: string): boolean {
  return existsSync(markerPath(sessionId, key));
}

function markInjected(sessionId: string, key: string): void {
  try {
    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(markerPath(sessionId, key), "");
  } catch (error) {
    console.error(
      `[style/test-counts] Failed to write cooldown marker: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const toolName = input.tool_name;

  let content: string | null = null;
  let key: string;

  if (toolName === "Write") {
    const toolInput = input.tool_input as WriteInput;
    if (!isMarkdownFile(getExtension(toolInput.file_path))) return null;
    content = toolInput.content;
    key = toolInput.file_path;
  } else if (toolName === "Edit") {
    const toolInput = input.tool_input as EditInput;
    if (!isMarkdownFile(getExtension(toolInput.file_path))) return null;
    content = toolInput.new_string;
    key = toolInput.file_path;
  } else if (hasBashCommand(input.tool_input)) {
    content = await extractMarkdownFromBash(input.tool_input.command, "style/test-counts");
    key = `bash:${input.tool_use_id}`;
  } else {
    content = extractMarkdownFromMcp(input.tool_input);
    key = `mcp:${input.tool_use_id}`;
  }

  if (!content) return null;
  if (!/\d/.test(content)) return null;
  if (alreadyInjected(input.session_id, key)) return null;

  markInjected(input.session_id, key);
  return formatContext(CONTEXT_MESSAGE);
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[style/test-counts] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
