#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import type { Heading, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { getExtension, isMarkdownFile, isMemoryPath, isPlanPath } from "../detection/paths";
import {
  type EditInput,
  formatDecision,
  isPlanMode,
  type SyncHookJSONOutput,
  type WriteInput,
} from "./io";

type Mode = "write" | "edit";

type MarkdownMatch = {
  text: string;
  line: number;
  column: number;
};

type AstGrepMatch = {
  message: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

export function checkMarkdown(content: string): string | null {
  const ast = fromMarkdown(content);
  const matches: MarkdownMatch[] = [];

  visit(ast, "heading", (node: Heading) => {
    const text = node.children
      .filter((child): child is Text => child.type === "text")
      .map((child) => child.value)
      .join("");

    if (/^[0-9]+\.\s/.test(text) || /^(Step|Phase|Part)\s+[0-9]+/i.test(text)) {
      matches.push({
        text: text.trim(),
        line: node.position?.start?.line || 0,
        column: node.position?.start?.column || 0,
      });
    }
  });

  if (matches.length > 0) {
    return `Numbered heading: ${matches[0]?.text}`;
  }

  return null;
}

// Extensions the numbering.yml languages cover. Gates subprocess spawns and
// must stay in sync with the numbering matchers in hooks.json (see hooks.test.ts).
export const SG_EXTENSIONS = new Set([
  "go",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "py",
]);

export async function checkCode(content: string, ext: string): Promise<string | null> {
  if (!SG_EXTENSIONS.has(ext)) return null;

  try {
    execSync("command -v sg", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return null;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "hook-check-"));
  const tmpFile = join(tmpDir, `check.${ext}`);
  const ruleFile = join(__dirname, "numbering.yml");

  try {
    await Bun.write(tmpFile, content);

    // sg scan returns exit code 1 when matches are found (as errors)
    // We need to capture stdout regardless of exit code
    let result: string;
    try {
      result = execSync(`sg scan --rule "${ruleFile}" --json "${tmpFile}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      // execSync throws on non-zero exit, but we want stdout
      const execError = error as { stdout?: string };
      result = (execError.stdout || "").trim();
    }

    if (result) {
      const matches: AstGrepMatch[] = JSON.parse(result);
      if (matches.length > 0) {
        return matches[0]?.message ?? null;
      }
    }
  } catch {
    // sg failed or parse error
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return null;
}

async function fileAlreadyNumbered(filePath: string, ext: string): Promise<boolean> {
  let existing: string;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return false;
    existing = await file.text();
  } catch {
    return false;
  }

  const match = isMarkdownFile(ext) ? checkMarkdown(existing) : await checkCode(existing, ext);
  return match !== null;
}

export async function processInput(
  input: PreToolUseHookInput,
  mode: Mode,
): Promise<SyncHookJSONOutput | null> {
  const toolName = input.tool_name;

  let content: string;
  let filePath: string;

  if (toolName === "Write") {
    const toolInput = input.tool_input as WriteInput;
    content = toolInput.content;
    filePath = toolInput.file_path;
  } else if (toolName === "Edit") {
    const toolInput = input.tool_input as EditInput;
    content = toolInput.new_string;
    filePath = toolInput.file_path;
  } else {
    return null;
  }

  if (isMemoryPath(filePath)) return null;
  if (isPlanPath(filePath)) return null;
  if (isPlanMode(input)) return null;

  const ext = getExtension(filePath);
  let match: string | null = null;

  if (isMarkdownFile(ext)) {
    match = checkMarkdown(content);
  } else {
    match = await checkCode(content, ext);
  }

  if (!match) {
    return null;
  }

  // Numbering already present in the target file was adjudicated when it was
  // introduced (approved by the user or pre-existing). Only first
  // introductions should prompt.
  if (await fileAlreadyNumbered(filePath, ext)) {
    return null;
  }

  const reason = `Detected numbered sequences that create tight coupling.
${match}

Use descriptive names instead. See CLAUDE.md Organization guidelines.`;

  if (mode === "edit") {
    return formatDecision("ask", `This edit introduces numbered sequences. ${reason}`);
  }

  const decision = isMarkdownFile(ext) ? "ask" : "deny";
  return formatDecision(decision, reason);
}

async function main(): Promise<void> {
  const mode = (process.argv[2] || "write") as Mode;

  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[style/numbering] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input, mode);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
