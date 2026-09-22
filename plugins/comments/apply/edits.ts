import type { CommentKind, Language } from "../detection/types";
import type { Verdict } from "../judge/schema";
import { type CommentStyle, conformToStyle, detectStyle, hasDelimiters } from "./comment-syntax";

/** One comment's range plus the verdict that decides how it is trimmed. */
export interface EditItem {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  kind: CommentKind;
  verdict: Verdict;
}

/** A comment the applier refused to touch, left for a human to handle. */
export interface EditSkip {
  startLine: number;
  reason: "manual";
  detail: string;
}

export interface FileEditResult {
  content: string;
  skips: EditSkip[];
}

export interface FileEditOptions {
  /**
   * Refuse a splice that would produce a line longer than this. Opt-in: with no
   * value, width is not checked, because a limit guessed below the target
   * repo's own would refuse edits that are in fact fine.
   */
  maxWidth?: number | undefined;
  /** Gates the empty-block guard, whose openers are Python's and shell's syntax. */
  language?: Language | undefined;
}

const isBlank = (line: string): boolean => line.trim().length === 0;

/** The `\r` a CRLF line keeps after `split("\n")`, re-appended to any line rebuilt from it. */
const lineEnding = (line: string | undefined): string => (line?.endsWith("\r") ? "\r" : "");

/** A line's prose: leading/trailing comment markers and whitespace stripped. */
export function stripCommentMarkers(line: string): string {
  return line
    .trim()
    .replace(/^(?:\/\*+|\/\/+|#+|--+|;+|"""|'''|\*+)\s*/, "")
    .replace(/\s*(?:\*+\/|"""|''')$/, "")
    .trim();
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** A code line: neither blank nor a `#` comment, the forms a Python or shell block cannot live on alone. */
const isCode = (line: string): boolean => !isBlank(line) && !line.trimStart().startsWith("#");

/** A line opening a block whose body cannot be empty: Python's `:`, shell's `then`, `do`, `else`. */
const BODY_OPENER = /(?::|\b(?:then|do|else))$/;

function applyFull(
  item: EditItem,
  lines: string[],
  deletions: Set<number>,
  replacements: Map<number, string>,
  removed: EditItem[],
  skips: EditSkip[],
): void {
  const before = (lines[item.startLine - 1] ?? "").slice(0, item.startColumn);
  const after = (lines[item.endLine - 1] ?? "").slice(item.endColumn);
  const wsBefore = before.trim().length === 0;
  const wsAfter = after.trim().length === 0;

  if (wsBefore && wsAfter) {
    for (let n = item.startLine; n <= item.endLine; n++) deletions.add(n);
    removed.push(item);
    return;
  }

  if (!wsBefore && wsAfter && item.kind === "line" && item.startLine === item.endLine) {
    const cr = lineEnding(lines[item.startLine - 1]);
    replacements.set(item.startLine, `${before.replace(/\s+$/, "")}${cr}`);
    return;
  }

  skips.push({
    startLine: item.startLine,
    reason: "manual",
    detail: "comment is interleaved with code on its line",
  });
}

/** Why judge text could not be conformed to the comment it would replace. */
function conformRefusal(style: CommentStyle): string {
  if (!hasDelimiters(style)) {
    return "comment uses delimiters the applier does not recognize; rewrite by hand";
  }
  const markers = style.form === "line" ? style.linePrefix : `${style.open} ${style.close}`;
  return `replacement text does not match the ${markers} comment it replaces; rewrite by hand`;
}

/** The refusal detail for a splice that would exceed `maxWidth`, else null. */
function widthRefusal(produced: string[], maxWidth: number | undefined): string | null {
  if (maxWidth === undefined) return null;
  const over = produced.find((line) => line.length > maxWidth);
  if (over == null || over === "") return null;
  return `replacement would produce a ${over.length}-character line (over ${maxWidth}); re-wrap by hand`;
}

/**
 * Replace a comment's span with judge-authored text (a `rewrite` or a partial
 * trim's `trimTo`). The text is conformed to the delimiters the site actually
 * uses and de-indented before the applier adds the site's indentation, so text
 * that arrives as bare prose or carrying its own indentation still splices as a
 * valid comment. For a full-line comment the span's lines become the indented
 * text lines. For a trailing line comment the text is spliced after the code,
 * one space apart. A form the site cannot host, an over-width result, or code
 * interleaved on the line is skipped and flagged, the same conservative bar
 * trims use.
 */
function replaceSpan(
  item: EditItem,
  text: string,
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
  skips: EditSkip[],
  maxWidth: number | undefined,
  eol: string,
): void {
  const before = (lines[item.startLine - 1] ?? "").slice(0, item.startColumn);
  const after = (lines[item.endLine - 1] ?? "").slice(item.endColumn);
  const wsBefore = before.trim().length === 0;
  const wsAfter = after.trim().length === 0;

  const style = detectStyle(lines, item);
  const conformed = conformToStyle(text, style);
  if (conformed == null) {
    skips.push({
      startLine: item.startLine,
      reason: "manual",
      detail: conformRefusal(style),
    });
    return;
  }
  const textLines = conformed.split("\n");
  const spanEnding = lineEnding(lines[item.endLine - 1]);
  // An unterminated last line carries no ending of its own, so interior lines fall back to the file's.
  const interior = item.endLine < lines.length ? spanEnding : eol;
  const withEndings = (produced: string[]): string[] =>
    produced.map((line, i) => `${line}${i === produced.length - 1 ? spanEnding : interior}`);

  if (wsBefore && wsAfter) {
    const indent = before;
    const produced = textLines.map((line) => `${indent}${line}`.replace(/\s+$/, ""));
    const tooWide = widthRefusal(produced, maxWidth);
    if (tooWide != null && tooWide !== "") {
      skips.push({ startLine: item.startLine, reason: "manual", detail: tooWide });
      return;
    }
    spanInserts.set(item.startLine, withEndings(produced));
    for (let n = item.startLine; n <= item.endLine; n++) deletions.add(n);
    return;
  }

  if (!wsBefore && wsAfter && item.kind === "line" && item.startLine === item.endLine) {
    const code = before.replace(/\s+$/, "");
    const produced = [`${code} ${textLines.join(" ")}`.replace(/\s+$/, "")];
    const tooWide = widthRefusal(produced, maxWidth);
    if (tooWide != null && tooWide !== "") {
      skips.push({ startLine: item.startLine, reason: "manual", detail: tooWide });
      return;
    }
    spanInserts.set(item.startLine, withEndings(produced));
    deletions.add(item.startLine);
    return;
  }

  skips.push({
    startLine: item.startLine,
    reason: "manual",
    detail: "comment is interleaved with code on its line",
  });
}

function applyRewrite(
  item: EditItem,
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
  skips: EditSkip[],
  maxWidth: number | undefined,
  eol: string,
): void {
  const rewrite = item.verdict.rewrite;
  if (rewrite == null || rewrite === "") {
    skips.push({
      startLine: item.startLine,
      reason: "manual",
      detail: "rewrite verdict carried no rewrite text",
    });
    return;
  }
  replaceSpan(item, rewrite, lines, deletions, spanInserts, skips, maxWidth, eol);
}

/** Line `n` as it reads after the edits (an insert by its `edge` line), or null when deleted. */
function survivingLine(
  n: number,
  edge: "first" | "last",
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
): string | null {
  const insert = spanInserts.get(n);
  if (insert) return (edge === "first" ? insert[0] : insert.at(-1)) ?? "";
  return deletions.has(n) ? null : (lines[n - 1] ?? "");
}

/**
 * True when deleting the comment leaves the block above it with no statement:
 * the nearest surviving code line above opens a body, and the next one below
 * sits at or left of the opener's indentation (or the file ends).
 */
function emptiesBlock(
  item: EditItem,
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
): boolean {
  let opener: string | null = null;
  for (let n = item.startLine - 1; n >= 1 && opener == null; n--) {
    const line = survivingLine(n, "last", lines, deletions, spanInserts);
    if (line != null && isCode(line)) opener = line;
  }
  if (opener == null || !BODY_OPENER.test(opener.trimEnd())) return false;
  for (let n = item.endLine + 1; n <= lines.length; n++) {
    const line = survivingLine(n, "first", lines, deletions, spanInserts);
    if (line != null && isCode(line)) return indentOf(line) <= indentOf(opener);
  }
  return true;
}

function restoreEmptiedBlocks(
  removed: EditItem[],
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
  skips: EditSkip[],
): void {
  for (const item of removed) {
    if (!emptiesBlock(item, lines, deletions, spanInserts)) continue;
    for (let n = item.startLine; n <= item.endLine; n++) deletions.delete(n);
    skips.push({
      startLine: item.startLine,
      reason: "manual",
      detail: "deleting the comment would leave its block with no body; remove it by hand",
    });
  }
}

/**
 * Rewrite a file by acting on each comment's verdict. Overlapping verdicts on
 * one line resolve with deletion winning over a replace. A span insert at a
 * line takes precedence over its own span's deletions.
 */
export function computeFileEdits(
  source: string,
  items: EditItem[],
  options: FileEditOptions = {},
): FileEditResult {
  const { maxWidth, language } = options;
  const lines = source.split("\n");
  const eol = source.includes("\r\n") ? "\r" : "";
  const deletions = new Set<number>();
  const replacements = new Map<number, string>();
  const spanInserts = new Map<number, string[]>();
  const skips: EditSkip[] = [];
  const removed: EditItem[] = [];

  for (const item of items) {
    switch (item.verdict.action) {
      case "keep":
        break;
      case "trim": {
        if (item.verdict.trimTo != null && item.verdict.trimTo !== "") {
          replaceSpan(
            item,
            item.verdict.trimTo,
            lines,
            deletions,
            spanInserts,
            skips,
            maxWidth,
            eol,
          );
        } else {
          applyFull(item, lines, deletions, replacements, removed, skips);
        }
        break;
      }
      case "rewrite":
        applyRewrite(item, lines, deletions, spanInserts, skips, maxWidth, eol);
        break;
      default:
        item.verdict.action satisfies never;
    }
  }
  if (language === "python" || language === "shellscript") {
    restoreEmptiedBlocks(removed, lines, deletions, spanInserts, skips);
  }

  const out: string[] = [];
  let lastPushed = "";
  let lastPushedBlank = false;
  for (let n = 1; n <= lines.length; n++) {
    const insert = spanInserts.get(n);
    if (insert) {
      for (const line of insert) {
        out.push(line);
        lastPushed = line;
        lastPushedBlank = isBlank(line);
      }
      continue;
    }
    if (deletions.has(n)) continue;
    const line = replacements.get(n) ?? lines[n - 1] ?? "";
    // A trim can leave a surviving blank line next to a blank we already kept,
    // collapsing `blank / deleted comment / blank` into a double blank. Drop it,
    // but only when a neighbor was deleted, so unrelated blank runs are untouched.
    if (isBlank(line) && lastPushedBlank && (deletions.has(n - 1) || deletions.has(n + 1))) {
      continue;
    }
    // Deleting a docstring directly under a `def f():` or `{` opener can leave a
    // blank as the block's first line. Drop a blank right after a deleted span
    // when the surviving line above the span opens a block.
    if (isBlank(line) && deletions.has(n - 1) && /[:{]$/.test(lastPushed.trimEnd())) {
      continue;
    }
    out.push(line);
    lastPushed = line;
    lastPushedBlank = isBlank(line);
  }
  return { content: out.join("\n"), skips };
}
