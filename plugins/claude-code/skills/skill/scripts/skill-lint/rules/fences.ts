const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

interface Fence {
  marker: string;
  length: number;
}

export interface MarkdownLine {
  text: string;
  /** 0-based index within the scanned text. */
  index: number;
  /** True inside a fenced block and on its delimiters. */
  fenced: boolean;
}

function closes(line: string, fence: Fence): boolean {
  const match = line.match(FENCE_CLOSE);
  if (match?.[1] == null || match[1] === "") return false;
  const marker = match[1];
  return marker[0] === fence.marker && marker.length >= fence.length;
}

export function markdownLines(text: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let fence: Fence | null = null;

  text.split("\n").forEach((line, index) => {
    if (fence) {
      if (closes(line, fence)) fence = null;
      lines.push({ text: line, index, fenced: true });
      return;
    }

    const open = line.match(FENCE_OPEN);
    if (open?.[1] != null && open[1] !== "") {
      fence = { marker: open[1][0] ?? "", length: open[1].length };
      lines.push({ text: line, index, fenced: true });
      return;
    }

    lines.push({ text: line, index, fenced: false });
  });

  return lines;
}
