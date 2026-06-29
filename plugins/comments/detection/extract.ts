import {
  type BundledLanguage,
  bundledLanguages,
  createHighlighter,
  type Highlighter,
  type ThemedToken,
} from "shiki";
import { lineStartOffsets, sliceRange } from "./offsets";
import type { Comment, CommentKind, Language } from "./types";

/**
 * A bare theme with no token styling. The grammar alone produces the scopes we
 * read, so this keeps Shiki's 1.8MB bundled theme set out of the dependency. The
 * name avoids `none`, which Shiki treats as a plain theme with no grammar state.
 */
const theme = { name: "bare", settings: [] };

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise == null) {
    highlighterPromise = createHighlighter({ themes: [theme], langs: [] });
  }
  return highlighterPromise;
}

function bundledLanguage(language: Language): BundledLanguage | null {
  return language in bundledLanguages ? (language as BundledLanguage) : null;
}

async function loadLanguage(highlighter: Highlighter, language: BundledLanguage): Promise<void> {
  if (highlighter.getLoadedLanguages().includes(language)) return;
  await highlighter.loadLanguage(bundledLanguages[language]);
}

function scopesOf(token: ThemedToken): string[] {
  return token.explanation?.flatMap((e) => e.scopes.map((s) => s.scopeName)) ?? [];
}

function kindForScopes(scopes: string[]): CommentKind | null {
  const has = (sub: string) => scopes.some((s) => s.includes(sub));
  if (
    has("comment.block.documentation") ||
    has("comment.line.documentation") ||
    has("string.quoted.docstring")
  ) {
    return "docstring";
  }
  if (has("comment.block")) return "block";
  if (has("comment.line")) return "line";
  return null;
}

function isCommentScope(scope: string): boolean {
  return scope.includes("comment.") || scope.includes("string.quoted.docstring");
}

function mergeKind(a: CommentKind, b: CommentKind): CommentKind {
  const rank = { line: 0, block: 1, docstring: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * A Python docstring scope is a real docstring only if the nearest preceding
 * significant line (non-blank, non-`#`) ends with `:` (a block opener) or there
 * is none (module start). This approximates "first statement of block/module"
 * without a parser, limiting the strings Shiki scopes as docstrings to those in
 * true docstring position.
 */
function isDocstringPosition(lines: string[], startLine: number): boolean {
  for (let i = startLine - 2; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed.endsWith(":");
  }
  return true;
}

function extract(highlighter: Highlighter, source: string, language: BundledLanguage): Comment[] {
  const lines = source.split("\n");
  const { tokens } = highlighter.codeToTokens(source, {
    lang: language,
    theme,
    includeExplanation: "scopeName",
  });

  // Whether a comment-ish scope is still open at each line's end, chaining the
  // grammar state line to line, so a multi-line block can be coalesced.
  const openAfter: boolean[] = [];
  let state: ReturnType<Highlighter["getLastGrammarState"]> | undefined;
  for (const line of lines) {
    const next = highlighter.getLastGrammarState(line, {
      lang: language,
      theme,
      ...(state != null && { grammarState: state }),
    });
    const scopes = next?.getScopes() ?? [];
    openAfter.push(scopes.some(isCommentScope));
    state = next;
  }

  const lineStart = lineStartOffsets(lines);

  const comments: Comment[] = [];
  let current: Comment | null = null;
  tokens.forEach((lineTokens, index) => {
    const lineNo = index + 1;
    for (const token of lineTokens) {
      if (token.content.length === 0) continue;
      const kind = kindForScopes(scopesOf(token));
      if (kind == null) continue;
      const startColumn = token.offset - (lineStart[index] ?? 0);
      const endColumn = startColumn + token.content.length;
      // Merge the token into the current comment when it abuts it on the same
      // line, or when it sits on a later line that the comment scope stayed open
      // through (a multi-line block, even across blank interior lines). A gap on
      // the same line, or a closed scope, starts a new comment, so adjacent `//`
      // lines and `/* a */ code /* b */` stay separate.
      if (
        current != null &&
        ((lineNo === current.endLine && startColumn === current.endColumn) ||
          (lineNo > current.endLine && openAfter[index - 1]))
      ) {
        current.endLine = lineNo;
        current.endColumn = endColumn;
        current.kind = mergeKind(current.kind, kind);
      } else {
        if (current != null) comments.push(current);
        // C-family grammars fold the whitespace before a trailing comment into
        // the opening token; start at the first non-whitespace so the text and
        // startColumn line up with the delimiter.
        const lead = token.content.length - token.content.trimStart().length;
        current = {
          kind,
          text: "",
          startLine: lineNo,
          endLine: lineNo,
          startColumn: startColumn + lead,
          endColumn,
        };
      }
    }
  });
  if (current != null) comments.push(current);

  for (const comment of comments) {
    comment.text = sliceRange(
      source,
      lineStart,
      comment.startLine,
      comment.startColumn,
      comment.endLine,
      comment.endColumn,
    );
  }

  if (language === "python") {
    return comments.filter(
      (comment) => comment.kind !== "docstring" || isDocstringPosition(lines, comment.startLine),
    );
  }
  return comments;
}

export async function extractComments(source: string, language: Language): Promise<Comment[]> {
  const bundled = bundledLanguage(language);
  if (bundled == null) return [];
  const highlighter = await getHighlighter();
  await loadLanguage(highlighter, bundled);
  return extract(highlighter, source, bundled);
}

const extensions: Record<string, Language> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  rs: "rust",
  sh: "shellscript",
  bash: "shellscript",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
};

export function languageForPath(path: string): Language | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return extensions[ext] ?? null;
}
