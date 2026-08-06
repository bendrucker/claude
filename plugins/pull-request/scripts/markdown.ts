// Text extraction over a PR body. Fenced code is excluded everywhere: a body's
// prose is what a reader reads, and a code block's contents are neither prose
// nor headings.

const FENCE_PATTERN = /^\s*(```|~~~)/;

export function linesOutsideFences(body: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const match = line.match(FENCE_PATTERN);
    if (match?.[1]) {
      fence = fence === null ? match[1] : fence === match[1] ? null : fence;
      continue;
    }
    if (fence === null) lines.push(line);
  }
  return lines;
}

export function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/(?<![\w`])__(.+?)__(?![\w`])/g, "$1")
    .replace(/(?<![\w`])_(.+?)_(?![\w`])/g, "$1");
}

/** Display text of every `##`-or-deeper heading, in document order. */
export function headingTexts(body: string): string[] {
  const headings: string[] = [];
  for (const line of linesOutsideFences(body)) {
    const match = line.match(/^#{2,6}\s+(.+)$/);
    if (match?.[1]) headings.push(match[1].trim());
  }
  return headings;
}

export function countProseWords(body: string): number {
  return linesOutsideFences(body)
    .join(" ")
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}
