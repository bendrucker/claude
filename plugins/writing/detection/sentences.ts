const HEADING = /^#{1,6}\s/;
const TABLE_ROW = /^\|/;

/**
 * Split text into sentences, filtering out headings and table rows.
 * Splitting heuristic: period/exclamation/question followed by whitespace
 * or end of string, or a bare newline. Returns trimmed, non-empty strings
 * with at least one word token.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<!\d)[.!?]+(?=\s|$)|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !TABLE_ROW.test(s))
    .filter((s) => !HEADING.test(s));
}

/**
 * Split text into paragraphs (blank-line separated), then for each paragraph
 * return its constituent sentences via splitSentences. Empty paragraphs are
 * dropped.
 */
export function splitParagraphs(text: string): string[][] {
  return text
    .split(/\n{2,}/)
    .map((para) => splitSentences(para))
    .filter((sentences) => sentences.length > 0);
}
