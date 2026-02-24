#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { apStyleTitleCase } from "ap-style-title-case";
import type { Heading, Paragraph, Strong, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
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

const PLACEHOLDER = "\0";

export function checkTitleCase(content: string): string | null {
  const ast = fromMarkdown(content);
  let result: string | null = null;

  visit(ast, "heading", (node: Heading) => {
    if (result) return;

    const allCode = node.children.every((child) => child.type === "inlineCode");
    if (allCode) return;

    const parts: string[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        parts.push(child.value);
      } else if (child.type === "inlineCode") {
        parts.push(PLACEHOLDER);
      }
    }

    const combined = parts.join("");
    const titleCased = apStyleTitleCase(combined);

    const originalParts = combined.split(PLACEHOLDER);
    const titleParts = titleCased.split(PLACEHOLDER);

    for (let i = 0; i < originalParts.length; i++) {
      if (originalParts[i] !== titleParts[i]) {
        const text = node.children
          .filter((child): child is Text => child.type === "text")
          .map((child) => child.value)
          .join("");
        result = `Heading "${text.trim()}" should be title case`;
        return;
      }
    }
  });

  return result;
}

export function checkBoldAsHeading(content: string): string | null {
  const ast = fromMarkdown(content);
  let result: string | null = null;

  visit(ast, "paragraph", (node: Paragraph) => {
    if (result) return;

    const first = node.children[0];
    if (first?.type !== "strong") return;

    const strong = first as Strong;
    const text = strong.children
      .filter((child): child is Text => child.type === "text")
      .map((child) => child.value)
      .join("");

    if (text.endsWith(":")) {
      result = `Bold text "${text}" should be a heading`;
    }
  });

  return result;
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const toolName = input.tool_name;

  let content: string | null = null;

  if (toolName === "Write") {
    const toolInput = input.tool_input as WriteInput;
    if (!isMarkdownFile(getExtension(toolInput.file_path))) return null;
    content = toolInput.content;
  } else if (toolName === "Edit") {
    const toolInput = input.tool_input as EditInput;
    if (!isMarkdownFile(getExtension(toolInput.file_path))) return null;
    content = toolInput.new_string;
  } else if (hasBashCommand(input.tool_input)) {
    content = await extractMarkdownFromBash(input.tool_input.command, "style/headings");
  } else {
    content = extractMarkdownFromMcp(input.tool_input);
  }

  if (!content) return null;

  const titleCase = checkTitleCase(content);
  if (titleCase) {
    return formatContext(
      `${titleCase}. Apply AP-style title case: capitalize major words, lowercase articles/prepositions (a, an, the, in, of, etc.) unless they start the heading.`,
    );
  }

  const boldHeading = checkBoldAsHeading(content);
  if (boldHeading) {
    return formatContext(
      `${boldHeading}. Replace the bold-colon pattern with a markdown heading (## ) at the appropriate level.`,
    );
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[style/headings] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
