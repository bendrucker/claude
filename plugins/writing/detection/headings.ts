import type { Heading, Paragraph, PhrasingContent, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { headingCaseViolations } from "../hooks/heading-case";
import { classifyHeadingBaseline } from "../linguistics/heading";
import { positionOfSample } from "./scan";

export interface HeadingFinding {
  line: number;
  col: number;
  message: string;
}

export const TITLE_CASE_ADVICE =
  "Apply AP-style title case: capitalize major words, lowercase articles/prepositions (a, an, the, in, of, etc.) unless they start the heading.";
export const BOLD_HEADING_ADVICE =
  "Replace the bold-colon pattern with a markdown heading (## ) at the appropriate level.";

function textOf(children: PhrasingContent[]): string {
  return children
    .filter((child): child is Text => child.type === "text")
    .map((child) => child.value)
    .join("");
}

// Title-case violations carry no source position, so each is located by its text.
export function titleCaseFindings(content: string): HeadingFinding[] {
  return headingCaseViolations(content).map((violation) => {
    const { line, col } = positionOfSample(content, violation.text);
    return {
      line,
      col,
      message: `Heading "${violation.text}" should be title case: "${violation.suggested}"`,
    };
  });
}

export function boldHeadingFindings(content: string): HeadingFinding[] {
  const findings: HeadingFinding[] = [];
  visit(fromMarkdown(content), "paragraph", (node: Paragraph) => {
    const first = node.children[0];
    if (first?.type !== "strong") return;
    const text = textOf(first.children);
    if (!text.endsWith(":")) return;
    findings.push({
      line: node.position?.start.line ?? 1,
      col: node.position?.start.column ?? 1,
      message: `Bold text "${text}" should be a heading`,
    });
  });
  return findings;
}

export function sentenceHeadingFindings(content: string): HeadingFinding[] {
  const findings: HeadingFinding[] = [];
  visit(fromMarkdown(content), "heading", (node: Heading) => {
    if (node.children.every((child) => child.type === "inlineCode")) return;
    const display = textOf(node.children).trim();
    if (!classifyHeadingBaseline(display).flagged) return;
    findings.push({
      line: node.position?.start.line ?? 1,
      col: node.position?.start.column ?? 1,
      message: `Heading "${display}" reads like a sentence. Cut it to the noun phrase that names the topic (a couple of words), and move the explanation into the first sentence of the section.`,
    });
  });
  return findings;
}
