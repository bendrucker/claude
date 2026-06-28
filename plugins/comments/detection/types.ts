/**
 * Shared contracts across the detection pipeline. extract → diff → scope → tells
 * all speak these types so each stage is independently testable. Line numbers are
 * 1-based and inclusive everywhere, matching unified-diff line numbers and the
 * human-facing `path:line` output.
 */

/**
 * A Shiki language id, mapped from a file extension by `languageForPath`. Most
 * languages route through Shiki's TextMate grammars (loaded from `node_modules`
 * on demand). SQL is the exception: it uses a string-aware scanner (`sql.ts`)
 * that understands dollar-quoted bodies, which no Shiki grammar handles.
 */
export type Language = string;

/**
 * `line` is a single-line comment (`#`, `//`). `block` is a delimited comment
 * (`/* *​/`). `docstring` is a Python module/class/function string literal in
 * statement position or a JSDoc `/** *​/` block: prose that documents a contract.
 */
export type CommentKind = "line" | "block" | "docstring";

export interface Comment {
  kind: CommentKind;
  /** Raw comment text including its markers, exactly as it appears in source. */
  text: string;
  /** 1-based inclusive. A block/docstring spans startLine..endLine. */
  startLine: number;
  endLine: number;
  /** 0-based column of the comment's first character on startLine. */
  startColumn: number;
  /** 0-based column just past the comment's last character on endLine. */
  endColumn: number;
}

/** A contiguous run of added/modified lines in the new version of a file. */
export interface LineRange {
  /** 1-based inclusive. */
  start: number;
  end: number;
}

/** Added/modified line ranges for one file in a diff. */
export interface FileDiff {
  path: string;
  added: LineRange[];
}

/** A comment that a change introduced, carrying the context the judge needs. */
export interface IntroducedComment extends Comment {
  path: string;
  language: Language;
}
