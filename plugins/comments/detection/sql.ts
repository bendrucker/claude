import type { Comment } from "./types";

/**
 * SQL comment extraction without a grammar. SQL has no tree-sitter wasm at an ABI
 * the pinned runtime can load, but its comment syntax is small enough to scan
 * directly. The scanner skips string and quoted-identifier literals so a `--` or
 * `/*` inside one is never mistaken for a comment, which is the only thing a naive
 * regex gets wrong.
 *
 * Block comments nest, matching DuckDB and PostgreSQL: a `/*` inside a block
 * comment opens a level that must be closed before the comment ends.
 */

const DOLLAR_TAG = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

export function extractSqlComments(source: string): Comment[] {
  const comments: Comment[] = [];
  const length = source.length;
  let index = 0;
  let line = 1;
  let column = 0;

  function advance(): void {
    if (source[index] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
    index++;
  }

  /** Consume a `'...'` or `"..."` literal, where the delimiter doubles to escape itself. */
  function skipQuoted(quote: string): void {
    advance();
    while (index < length) {
      if (source[index] === quote) {
        if (source[index + 1] === quote) {
          advance();
          advance();
          continue;
        }
        advance();
        return;
      }
      advance();
    }
  }

  /** Consume a `$tag$...$tag$` (or `$$...$$`) dollar-quoted string. Returns false if not one. */
  function skipDollarQuote(): boolean {
    DOLLAR_TAG.lastIndex = index;
    const match = DOLLAR_TAG.exec(source);
    if (match == null || match.index !== index) return false;
    const tag = match[0];
    for (let k = 0; k < tag.length; k++) advance();
    const close = source.indexOf(tag, index);
    const end = close === -1 ? length : close + tag.length;
    while (index < end) advance();
    return true;
  }

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "-" && next === "-") {
      const startLine = line;
      const startColumn = column;
      const start = index;
      while (index < length && source[index] !== "\n") advance();
      comments.push({
        kind: "line",
        text: source.slice(start, index),
        startLine,
        endLine: line,
        startColumn,
        endColumn: column,
      });
      continue;
    }

    if (char === "/" && next === "*") {
      const startLine = line;
      const startColumn = column;
      const start = index;
      advance();
      advance();
      let depth = 1;
      while (index < length && depth > 0) {
        if (source[index] === "/" && source[index + 1] === "*") {
          advance();
          advance();
          depth++;
        } else if (source[index] === "*" && source[index + 1] === "/") {
          advance();
          advance();
          depth--;
        } else {
          advance();
        }
      }
      comments.push({
        kind: "block",
        text: source.slice(start, index),
        startLine,
        endLine: line,
        startColumn,
        endColumn: column,
      });
      continue;
    }

    if (char === "'" || char === '"') {
      skipQuoted(char);
      continue;
    }

    if (char === "$" && skipDollarQuote()) continue;

    advance();
  }

  return comments;
}
