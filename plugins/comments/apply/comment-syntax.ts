import type { EditItem } from "./edits";

/**
 * The delimiters in use at a comment site. They are absent when the site's
 * markers are unrecognized, and text cannot be conformed to a style that
 * carries none.
 */
export interface CommentStyle {
  form: "block" | "line";
  open?: string | undefined;
  close?: string | undefined;
  continuation?: string | undefined;
  linePrefix?: string | undefined;
}

interface BlockOpener {
  open: string;
  close: string;
  continuation?: string | undefined;
}

/** Longest opener first, so `/**` is not read as `/*`. */
const BLOCK_OPENERS: BlockOpener[] = [
  { open: "/**", close: "*/", continuation: "*" },
  { open: "/*", close: "*/" },
  { open: '"""', close: '"""' },
  { open: "'''", close: "'''" },
];

/**
 * Longest prefix first, so a Rust `///` or `//!` doc comment is not read as a
 * plain `//` and quietly demoted to one when its delimiters are re-emitted.
 */
const LINE_PREFIXES = ["///", "//!", "//", "#", "--"];

/** The comment's own text, with the code before and after its span removed. */
export function spanLines(lines: string[], item: EditItem): string[] {
  const first = lines[item.startLine - 1] ?? "";
  if (item.startLine === item.endLine) return [first.slice(item.startColumn, item.endColumn)];
  const out = [first.slice(item.startColumn)];
  for (let n = item.startLine + 1; n < item.endLine; n++) out.push(lines[n - 1] ?? "");
  out.push((lines[item.endLine - 1] ?? "").slice(0, item.endColumn));
  return out;
}

function readStyle(commentLines: string[]): CommentStyle | null {
  const first = (commentLines[0] ?? "").trimStart();
  for (const opener of BLOCK_OPENERS) {
    if (!first.startsWith(opener.open)) continue;
    const interior = commentLines.slice(1, -1);
    const starred = interior.some((line) => line.trim().startsWith("*"));
    const continuation = starred ? "*" : opener.continuation;
    return { form: "block", open: opener.open, close: opener.close, continuation };
  }
  for (const prefix of LINE_PREFIXES) {
    if (first.startsWith(prefix)) return { form: "line", linePrefix: prefix };
  }
  return null;
}

/**
 * The delimiters actually in use at the comment's source span. Read from the
 * site rather than inferred from `item.kind`, so a `#` run and a `//` run are
 * distinguished and a Javadoc block keeps its ` * ` continuation.
 */
export function detectStyle(lines: string[], item: EditItem): CommentStyle {
  const style = readStyle(spanLines(lines, item));
  if (style) return style;
  return { form: item.kind === "line" ? "line" : "block" };
}

/** C-style `/* *​/` and quoted docstrings cannot substitute for each other. */
function blockFamily(open: string): string {
  return open.startsWith("/") ? "c" : "quote";
}

function compatible(text: CommentStyle, site: CommentStyle): boolean {
  if (text.form !== site.form) return false;
  if (site.form === "line") return text.linePrefix === site.linePrefix;
  return (
    text.open !== undefined &&
    site.open !== undefined &&
    blockFamily(text.open) === blockFamily(site.open)
  );
}

function stripCommonIndent(text: string): string[] {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(common));
}

function wrapBlock(
  prose: string[],
  open: string,
  close: string,
  continuation: string | undefined,
): string[] {
  if (prose.length === 1) return [`${open} ${prose[0]} ${close}`];
  const body = prose.map((line) => {
    if (continuation === undefined) return line;
    return line.length === 0 ? ` ${continuation}` : ` ${continuation} ${line}`;
  });
  return [open, ...body, continuation === undefined ? close : ` ${close}`];
}

/** Prefix every line that lacks the marker, so no line of the text splices in as code. */
function wrapLine(prose: string[], linePrefix: string): string[] {
  return prose.map((line) => {
    if (line.trimStart().startsWith(linePrefix)) return line;
    return line.length === 0 ? linePrefix : `${linePrefix} ${line}`;
  });
}

/** True when the block's first close is its last characters, so nothing trails it as code. */
function closesAtEnd(text: string, open: string, close: string): boolean {
  const body = text.trimEnd();
  return body.indexOf(close, text.indexOf(open) + open.length) === body.length - close.length;
}

/** True when the site's markers were recognized, so text can be conformed. */
export function hasDelimiters(style: CommentStyle): boolean {
  return style.form === "line" ? style.linePrefix !== undefined : style.open !== undefined;
}

/**
 * Make judge-authored text splice-ready for a site in `style`: strip the text's
 * own common indentation (the applier owns indentation) and give it the site's
 * delimiters, re-emitting them when the text is bare prose. Every line of a line
 * comment carries the prefix. Returns null, a refusal rather than a splice that
 * breaks the file, when the text carries a comment form the site cannot host,
 * when text would trail a block's close, or when the site's markers went
 * unrecognized.
 */
export function conformToStyle(text: string, style: CommentStyle): string | null {
  const lines = stripCommonIndent(text);
  const textStyle = readStyle(lines);
  if (textStyle && !(hasDelimiters(style) && compatible(textStyle, style))) return null;
  if (style.form === "block") {
    const { open, close } = style;
    if (open === undefined || close === undefined) return null;
    if (textStyle?.open !== undefined && textStyle.close !== undefined) {
      const joined = lines.join("\n");
      return closesAtEnd(joined, textStyle.open, textStyle.close) ? joined : null;
    }
    if (lines.some((line) => line.includes(close))) return null;
    return wrapBlock(lines, open, close, style.continuation).join("\n");
  }
  const { linePrefix } = style;
  return linePrefix === undefined ? null : wrapLine(lines, linePrefix).join("\n");
}
