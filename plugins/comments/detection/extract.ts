import { join } from "node:path";
import Parser from "web-tree-sitter";
import { extractSqlComments } from "./sql";
import type { Comment, CommentKind, Language } from "./types";

type TSNode = Parser.SyntaxNode;

let initPromise: Promise<void> | null = null;

function init(): Promise<void> {
  if (initPromise == null) initPromise = Parser.init();
  return initPromise;
}

const languages = new Map<Language, Parser.Language>();

async function loadLanguage(language: Language): Promise<Parser.Language> {
  const cached = languages.get(language);
  if (cached != null) return cached;
  const wasmPath = join(import.meta.dirname, "..", "grammars", `tree-sitter-${language}.wasm`);
  const lang = await Parser.Language.load(wasmPath);
  languages.set(language, lang);
  return lang;
}

function classifyComment(text: string): CommentKind {
  if (text.startsWith("/**")) return "docstring";
  if (text.startsWith("/*")) return "block";
  return "line";
}

function toComment(node: TSNode, kind: CommentKind): Comment {
  return {
    kind,
    text: node.text,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}

function samePosition(a: TSNode, b: TSNode): boolean {
  return (
    a.startPosition.row === b.startPosition.row && a.startPosition.column === b.startPosition.column
  );
}

function isPythonDocstring(node: TSNode): boolean {
  const statement = node.parent;
  if (statement == null || statement.type !== "expression_statement") return false;
  const body = statement.parent;
  if (body == null || (body.type !== "block" && body.type !== "module")) return false;
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (child == null) continue;
    if (child.type === "comment") continue;
    return samePosition(child, statement);
  }
  return false;
}

const commentTypes = new Set(["comment", "line_comment", "block_comment"]);

function collect(node: TSNode, language: Language, comments: Comment[]): void {
  if (commentTypes.has(node.type)) {
    comments.push(toComment(node, classifyComment(node.text)));
  } else if (language === "python" && node.type === "string" && isPythonDocstring(node)) {
    comments.push(toComment(node, "docstring"));
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child != null) collect(child, language, comments);
  }
}

export async function extractComments(source: string, language: Language): Promise<Comment[]> {
  if (language === "sql") return extractSqlComments(source);
  await init();
  const lang = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (tree == null) throw new Error(`failed to parse ${language} source`);
  const comments: Comment[] = [];
  collect(tree.rootNode, language, comments);
  comments.sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn);
  return comments;
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
  sh: "bash",
  bash: "bash",
  sql: "sql",
};

export function languageForPath(path: string): Language | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return extensions[ext] ?? null;
}
