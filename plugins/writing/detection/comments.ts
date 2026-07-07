const SINGLE_LINE_COMMENT = /(?:^|\s)(?:\/\/|#)[^\n]*/g;

// Pull single-line comments (`//`, `#`) out of source so they can be checked
// as prose. No AST: this catches the common case and treats every comment line
// as prose regardless of language.
export function extractComments(text: string): string {
  const lines: string[] = [];
  for (const match of text.matchAll(SINGLE_LINE_COMMENT)) {
    lines.push(match[0].replace(/^\s*(?:\/\/|#)\s?/, ""));
  }
  return lines.join("\n");
}
