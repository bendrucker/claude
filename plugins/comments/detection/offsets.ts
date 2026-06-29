/**
 * Character-offset arithmetic for slicing source by line and column. Extraction
 * records a comment's text from a range, and drift detection re-reads the text
 * at that range. Both go through here so the two never diverge on an edge case
 * (a trailing newline, a `\r\n` line ending) and mis-compare.
 */

/** The character offset at the start of each line, indexed 0-based by line - 1. */
export function lineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

/**
 * The source substring from [startLine, startColumn] to [endLine, endColumn],
 * with 1-based lines and 0-based columns. `lineStart` comes from
 * `lineStartOffsets(source.split("\n"))`.
 */
export function sliceRange(
  source: string,
  lineStart: number[],
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): string {
  const start = (lineStart[startLine - 1] ?? 0) + startColumn;
  const end = (lineStart[endLine - 1] ?? 0) + endColumn;
  return source.slice(start, end);
}
