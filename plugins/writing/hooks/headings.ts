import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { apStyleTitleCase } from "ap-style-title-case";
import type { Heading, Paragraph, Strong, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { getExtension, isMarkdownFile } from "../detection/paths";
import { classifyHeadingBaseline } from "../linguistics/heading";
import {
  type EditInput,
  formatContext,
  type HookResult,
  type SyncHookJSONOutput,
  type WriteInput,
} from "./io";

const PLACEHOLDER = "\0";

// ap-style-title-case ships a stopword list missing two words AP lowercases:
// `as` (a short conjunction/preposition) and `vs`/`vs.` (versus). Without
// them the checker flags correct headings like "X as Y" and "A vs. B". The
// library splits on commas and colons but not periods, so `vs.` is one token.
const AP_STOPWORDS = [
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "so",
  "the",
  "to",
  "up",
  "vs",
  "vs.",
  "yet",
];

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
    const titleCased = apStyleTitleCase(combined, { stopwords: AP_STOPWORDS });

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

    const verdict = classifyHeadingBaseline(display);
    if (verdict.flagged) {
      result = `Heading "${display}" reads like a sentence. Cut it to the noun phrase that names the topic (a couple of words), and move the explanation into the first sentence of the section.`;
    }
  });

  return result;
}

export function check(input: PreToolUseHookInput): HookResult | null {
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

  const ext = getExtension(filePath);
  if (!isMarkdownFile(ext)) return null;

  const titleCase = checkTitleCase(content);
  if (titleCase) {
    return {
      output: formatContext(
        `${titleCase}. Apply AP-style title case: capitalize major words, lowercase articles/prepositions (a, an, the, in, of, etc.) unless they start the heading.`,
      ),
      category: "title case heading",
    };
  }

  const boldHeading = checkBoldAsHeading(content);
  if (boldHeading) {
    return {
      output: formatContext(
        `${boldHeading}. Replace the bold-colon pattern with a markdown heading (## ) at the appropriate level.`,
      ),
      category: "bold as heading",
    };
  }

  const sentenceHeading = checkSentenceHeading(content);
  if (sentenceHeading) {
    return { output: formatContext(sentenceHeading), category: "sentence heading" };
  }

  return null;
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  return check(input)?.output ?? null;
}
