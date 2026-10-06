// AST-based markdown structure shared by the reference-file rules. mdast parses
// fenced and indented code the same way (both are `code` nodes), so this covers
// what a regex fence scanner would classify as "fenced" plus the indented case
// such a scanner cannot see.

import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";

export interface Span {
  /** Byte offset of the first character. */
  start: number;
  /** Byte offset one past the last character. */
  end: number;
}

/** Byte ranges of every code block (fenced or indented) in document order. */
export function codeSpans(body: string): Span[] {
  const spans: Span[] = [];
  visit(fromMarkdown(body), "code", (node) => {
    const { start, end } = node.position ?? {};
    if (start?.offset === undefined || end?.offset === undefined) return;
    spans.push({ start: start.offset, end: end.offset });
  });
  return spans;
}

/** 1-based line number containing a byte offset. */
export function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

/**
 * Line numbers of a bold label opening a line, e.g. `**Config**: value`. A
 * `strong` node at column 1 marks true line-start, including the lazily
 * continued second line of a paragraph. A list marker, blockquote prefix, or
 * heading hash all push the column past 1, which excludes them the same way a
 * line-start regex would.
 */
export function boldLabelLines(body: string): number[] {
  const lines: number[] = [];
  visit(fromMarkdown(body), "strong", (node, index, parent) => {
    if (node.position?.start.column !== 1 || index == null || parent == null) return;
    const next = parent.children[index + 1];
    if (next?.type !== "text" || !next.value.startsWith(":")) return;
    lines.push(node.position.start.line);
  });
  return lines;
}
