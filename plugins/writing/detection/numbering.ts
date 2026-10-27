import type { Heading, Text } from "mdast";
import { loadMarkdown } from "./mdast";

// Step/phase/part token near a digit. Every shape the numbering checks flag
// carries one, so this prefilter gates the expensive path in-process.
const NUMBER_HINT = /(step|phase|part).{0,8}[0-9]/i;

export function hasNumberingHint(content: string): boolean {
  return NUMBER_HINT.test(content);
}

export interface NumberingFinding {
  line: number;
  col: number;
  text: string;
}

// Bare `N. ` headings are usually rankings or enumerations, not process steps,
// so only explicit step labels count.
const STEP_HEADING = /^(Step|Phase|Part)\s+[0-9]+/i;

export async function markdownNumberingFindings(content: string): Promise<NumberingFinding[]> {
  const { fromMarkdown, visit } = await loadMarkdown();
  const findings: NumberingFinding[] = [];

  visit(fromMarkdown(content), "heading", (node: Heading) => {
    const text = node.children
      .filter((child): child is Text => child.type === "text")
      .map((child) => child.value)
      .join("");
    if (!STEP_HEADING.test(text)) return;
    findings.push({
      line: node.position?.start.line ?? 1,
      col: node.position?.start.column ?? 1,
      text: text.trim(),
    });
  });

  return findings;
}

export function numberingMessage(text: string): string {
  return `Numbered step heading: ${text}`;
}
