#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
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

const LINKING_VERBS = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "holds",
  "hold",
  "keeps",
  "keep",
  "makes",
  "make",
  "becomes",
  "become",
  "handles",
  "handle",
  "supports",
  "support",
]);

const IMPERATIVE_OPENERS = new Set([
  "build",
  "document",
  "stabilize",
  "expose",
  "add",
  "remove",
  "configure",
  "implement",
  "ensure",
]);

const ENUMERATOR_STOPLIST =
  /^(step|stage|phase|pattern|example|part|section|option|level|tier|q)\b/i;

const INTERROGATIVE_OPENERS = new Set(["what", "why", "how", "whether", "when", "where", "which"]);

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

export function checkSentenceHeading(content: string): string | null {
  const ast = fromMarkdown(content);
  let result: string | null = null;

  visit(ast, "heading", (node: Heading) => {
    if (result) return;

    const allCode = node.children.every((child) => child.type === "inlineCode");
    if (allCode) return;

    const display = node.children
      .filter((child): child is Text => child.type === "text")
      .map((child) => child.value)
      .join("")
      .trim();

    const analysis = display
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(
        /^(step|stage|phase|pattern|example|part|section|option|level|tier|q)\s*\d*\s*:?\s*/i,
        "",
      )
      .trim();

    const words = analysis.split(/\s+/).filter((word) => word.length > 0);
    const lower = words.map((word) => word.toLowerCase().replace(/[^a-z']/g, ""));

    // Interrogative-led headings ("Why X is Y", "What was wrong") are a
    // conventional rationale-section label, not the sentence-heading trope.
    if (lower[0] && INTERROGATIVE_OPENERS.has(lower[0])) return;

    const message = `Heading "${display}" reads like a sentence. Cut it to the noun phrase that names the topic (a couple of words), and move the explanation into the first sentence of the section.`;

    const colonIndex = analysis.indexOf(":");
    if (colonIndex !== -1) {
      const before = analysis
        .slice(0, colonIndex)
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0);
      const after = analysis
        .slice(colonIndex + 1)
        .trim()
        .split(/\s+/)
        .map((word) => word.toLowerCase().replace(/[^a-z']/g, ""))
        .filter((word) => word.length > 0);
      const afterPredicate = after.some((word) => LINKING_VERBS.has(word) || word === "not");
      const preEnumerator = before[0] ? ENUMERATOR_STOPLIST.test(before[0]) : false;
      if (before.length <= 4 && after.length >= 3 && afterPredicate && !preEnumerator) {
        result = message;
        return;
      }
    }

    if (lower.some((word) => LINKING_VERBS.has(word))) {
      result = message;
      return;
    }

    if (
      words.length >= 4 &&
      lower.some((word) => word === "that" || word === "which" || word === "who")
    ) {
      result = message;
      return;
    }

    if (words.length >= 3 && lower[0] && IMPERATIVE_OPENERS.has(lower[0])) {
      result = message;
      return;
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

  const sentenceHeading = checkSentenceHeading(content);
  if (sentenceHeading) {
    return formatContext(sentenceHeading);
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

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
