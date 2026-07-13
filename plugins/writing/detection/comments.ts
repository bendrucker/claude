const SINGLE_LINE_COMMENT = /(?:^|\s)(?:\/\/|#)[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const TRIPLE_QUOTED = /("""|''')[\s\S]*?\1/g;

// Strip a block comment's delimiters and the leading `*` gutter JSDoc-style
// bodies carry on each line.
function blockBody(block: string): string {
  return block
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join("\n")
    .trim();
}

// Pull comments out of source so they can be checked as prose: single-line
// (`//`, `#`), block (`/* */`, including JSDoc), HTML (`<!-- -->`), and
// triple-quoted Python docstrings. No AST: this catches the common cases and
// treats every comment as prose regardless of language.
export function extractComments(text: string): string {
  const parts: string[] = [];
  for (const match of text.matchAll(SINGLE_LINE_COMMENT)) {
    parts.push(match[0].replace(/^\s*(?:\/\/|#)\s?/, ""));
  }
  for (const match of text.matchAll(BLOCK_COMMENT)) {
    parts.push(blockBody(match[0]));
  }
  for (const match of text.matchAll(HTML_COMMENT)) {
    parts.push(
      match[0]
        .replace(/^<!--\s?/, "")
        .replace(/\s?-->$/, "")
        .trim(),
    );
  }
  for (const match of text.matchAll(TRIPLE_QUOTED)) {
    parts.push(match[0].slice(3, -3).trim());
  }
  return parts.filter((part) => part.length > 0).join("\n");
}
