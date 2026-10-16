import { basename } from "node:path";
import { type BundledLanguage, bundledLanguages, createHighlighter } from "shiki";
import { getExtension } from "./paths";

// Shiki needs a theme to tokenize. The grammar alone produces the scopes read
// here, so an empty one avoids loading a bundled theme.
const theme = { name: "bare", settings: [] };

// Extensions Shiki has no alias for.
const EXTENSION_LANGUAGES: Record<string, BundledLanguage> = {
  h: "c",
  cc: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  htm: "html",
  svg: "xml",
  ex: "elixir",
  exs: "elixir",
  pl: "perl",
  ml: "ocaml",
  el: "emacs-lisp",
  j2: "jinja",
};

function isBundledLanguage(id: string): id is BundledLanguage {
  return id in bundledLanguages;
}

// Resolve by extension, or by name for extensionless files like `Dockerfile`.
export function languageForPath(filePath: string): BundledLanguage | null {
  const name = basename(filePath).toLowerCase();
  const ext = getExtension(name);
  const key = ext === "" ? name : ext;
  return EXTENSION_LANGUAGES[key] ?? (isBundledLanguage(key) ? key : null);
}

function isCommentText(scopes: string[]): boolean {
  const inComment = scopes.some(
    (s) => s.startsWith("comment.") || s.startsWith("string.quoted.docstring"),
  );
  const delimiter = scopes.some(
    (s) =>
      s.startsWith("punctuation.definition.comment") ||
      s.startsWith("punctuation.definition.string"),
  );
  return inComment && !delimiter;
}

function stripGutter(comment: string): string {
  return comment
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join("\n")
    .trim();
}

// Pull comments and docstrings out of source by the grammar for the file's
// language, so each language's own comment syntax applies, including CSS and
// JS embedded in HTML. An unknown language returns an empty string.
export async function extractComments(text: string, filePath: string): Promise<string> {
  const lang = languageForPath(filePath);
  if (lang == null || text === "") return "";
  const highlighter = await createHighlighter({ themes: [theme], langs: [lang] });
  const { tokens } = highlighter.codeToTokens(text, {
    lang,
    theme,
    includeExplanation: "scopeName",
  });

  const parts: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current != null) parts.push(stripGutter(current));
    current = null;
  };
  for (const line of tokens) {
    for (const piece of line.flatMap((token) => token.explanation ?? [])) {
      const scopes = piece.scopes.map((scope) => scope.scopeName);
      if (isCommentText(scopes)) current = (current ?? "") + piece.content;
      else if (!scopes.some((s) => s.startsWith("punctuation.definition.comment"))) flush();
    }
    if (current != null) current += "\n";
  }
  flush();
  return parts.filter((part) => part.length > 0).join("\n");
}
