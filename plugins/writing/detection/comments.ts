import { basename } from "node:path";
import { type BundledLanguage, bundledLanguages, createHighlighter, type Highlighter } from "shiki";
import { getExtension } from "./paths";

// Shiki needs a theme to tokenize. The grammar alone produces the scopes read
// here, so an empty one avoids loading a bundled theme.
const theme = { name: "bare", settings: [] };

// Extensions and file names Shiki has no alias for.
const EXTENSION_LANGUAGES = new Map<string, BundledLanguage>([
  ["bashrc", "shellscript"],
  ["zshrc", "shellscript"],
  ["zprofile", "shellscript"],
  ["profile", "shellscript"],
  ["envrc", "shellscript"],
  ["env", "dotenv"],
  ["containerfile", "dockerfile"],
  ["h", "c"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["hh", "cpp"],
  ["hpp", "cpp"],
  ["htm", "html"],
  ["svg", "xml"],
  ["ex", "elixir"],
  ["exs", "elixir"],
  ["pl", "perl"],
  ["ml", "ocaml"],
  ["el", "emacs-lisp"],
  ["j2", "jinja"],
]);

const MAX_LINE_LENGTH = 2_000;

let highlighter: Promise<Highlighter> | undefined;

async function highlighterFor(lang: BundledLanguage): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [theme], langs: [] });
  const loaded = await highlighter;
  if (!loaded.getLoadedLanguages().includes(lang)) await loaded.loadLanguage(lang);
  return loaded;
}

function isBundledLanguage(id: string): id is BundledLanguage {
  return Object.hasOwn(bundledLanguages, id);
}

export function languageForPath(filePath: string): BundledLanguage | null {
  const name = basename(filePath).toLowerCase();
  const ext = getExtension(name);
  const key = ext === "" ? name : ext;
  return EXTENSION_LANGUAGES.get(key) ?? (isBundledLanguage(key) ? key : null);
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

// Extract comments by the file's language grammar, including CSS and JS
// embedded in HTML.
export async function extractComments(text: string, filePath: string): Promise<string> {
  const lang = languageForPath(filePath);
  if (lang == null || text === "") return "";
  // Minified and generated lines stall the tokenizer and crash its scope
  // explanation. Dropping only the line would shift the grammar state of the
  // lines after it, so skip the whole file.
  if (text.split("\n").some((line) => line.length > MAX_LINE_LENGTH)) return "";
  const { tokens } = (await highlighterFor(lang)).codeToTokens(text, {
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
