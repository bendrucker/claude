// Text extraction over a PR body. Fenced code is excluded everywhere: a body's
// prose is what a reader reads, and a code block's contents are neither prose
// nor headings.

import { extractHeadings } from "./heading-case";

const FENCE_MARKER = /^\s*(`{3,}|~{3,})(.*)$/;

// Per CommonMark, a fence closes only on a run of the same character at least
// as long as the opener, with nothing after it. A shorter run, the other
// character, or a trailing info string is fence content. Each fenced block
// yields one blank line so the paragraphs around it stay separate.
export function linesOutsideFences(body: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const match = line.match(FENCE_MARKER);
    const marker = match?.[1];
    if (marker !== undefined) {
      if (fence === null) {
        fence = marker;
        lines.push("");
        continue;
      }
      if (marker[0] === fence[0] && marker.length >= fence.length && match?.[2]?.trim() === "") {
        fence = null;
      }
      continue;
    }
    if (fence === null) lines.push(line);
  }
  return lines;
}

export function stripEmphasis(text: string): string {
  return text
    .replaceAll(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replaceAll(/\*\*(.+?)\*\*/g, "$1")
    .replaceAll(/\*(.+?)\*/g, "$1")
    .replaceAll(/(?<![\w`])__(.+?)__(?![\w`])/g, "$1")
    .replaceAll(/(?<![\w`])_(.+?)_(?![\w`])/g, "$1");
}

/**
 * Display text of every `##`-or-deeper heading, in document order. Delegates
 * to the mdast parse in `heading-case.ts` so the sentence-shape warn and the
 * title-case deny read the same headings.
 */
export function headingTexts(body: string): string[] {
  return extractHeadings(body)
    .filter((heading) => heading.depth >= 2)
    .map((heading) => heading.text);
}

export function countProseWords(body: string): number {
  return linesOutsideFences(body)
    .join(" ")
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}
