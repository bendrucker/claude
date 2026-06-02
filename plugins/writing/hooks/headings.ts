#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { runHook } from "@bendrucker/claude-hook";
import { apStyleTitleCase } from "ap-style-title-case";
import type { Heading, Paragraph, Strong, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import {
  type EditInput,
  formatContext,
  getExtension,
  isMarkdownFile,
  isMemoryPath,
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

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
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
  if (!isMarkdownFile(ext)) return null;

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

if (import.meta.main) {
  runHook(processInput, "style/headings");
}
