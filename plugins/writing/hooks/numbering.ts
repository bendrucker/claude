#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { runHook } from "@bendrucker/claude-hook";
import type { Heading, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import {
  type EditInput,
  formatDecision,
  getExtension,
  isMarkdownFile,
  isMemoryPath,
  type SyncHookJSONOutput,
  type WriteInput,
} from "./markdown";

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

export async function checkCode(content: string, ext: string): Promise<string | null> {
  // Check if sg is available
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

  const reason = `Detected numbered sequences that create tight coupling.
${match}

Use descriptive names instead. See CLAUDE.md Organization guidelines.`;

  if (mode === "write") {
    return formatDecision("deny", reason);
  } else {
    return formatDecision("ask", `This edit introduces numbered sequences. ${reason}`);
  }
}

if (import.meta.main) {
  const mode = (process.argv[2] || "write") as Mode;
  runHook((input: PreToolUseHookInput) => processInput(input, mode), "style/numbering");
}
