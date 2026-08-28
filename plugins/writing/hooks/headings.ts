import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { Heading, Paragraph, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { getExtension, isMarkdownFile } from "../detection/paths";
import { classifyHeadingBaseline } from "../linguistics/heading";
import { headingCaseViolations } from "./heading-case";
import { editedContent, formatContext, type HookResult } from "./io";

// Reports the exact re-casing rather than just naming the heading, so the fix
// needs no second guess about which words AP lowercases.
export function checkTitleCase(content: string): string | null {
  const violations = headingCaseViolations(content);
  const first = violations[0];
  if (!first) return null;
  return `Heading "${first.text}" should be title case: "${first.suggested}"`;
}

export function checkBoldAsHeading(content: string): string | null {
  const ast = fromMarkdown(content);
  let result: string | null = null;

  visit(ast, "paragraph", (node: Paragraph) => {
    if (result != null && result !== "") return;

    const first = node.children[0];
    if (first?.type !== "strong") return;

    const text = first.children
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
    if (result != null && result !== "") return;

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
  const edited = editedContent(input);
  if (!edited) return null;
  const { content, filePath } = edited;

  const ext = getExtension(filePath);
  if (!isMarkdownFile(ext)) return null;

  const titleCase = checkTitleCase(content);
  if (titleCase != null && titleCase !== "") {
    return {
      output: formatContext(
        `${titleCase}. Apply AP-style title case: capitalize major words, lowercase articles/prepositions (a, an, the, in, of, etc.) unless they start the heading.`,
      ),
      category: "title case heading",
    };
  }

  const boldHeading = checkBoldAsHeading(content);
  if (boldHeading != null && boldHeading !== "") {
    return {
      output: formatContext(
        `${boldHeading}. Replace the bold-colon pattern with a markdown heading (## ) at the appropriate level.`,
      ),
      category: "bold as heading",
    };
  }

  const sentenceHeading = checkSentenceHeading(content);
  if (sentenceHeading != null && sentenceHeading !== "") {
    return { output: formatContext(sentenceHeading), category: "sentence heading" };
  }

  return null;
}
