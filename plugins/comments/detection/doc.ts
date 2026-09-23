import { z } from "zod";
import type { Comment, Language } from "./types";

/**
 * A comment in the language's formal doc-comment position: Go `//` directly
 * above a declaration or `package` clause, JSDoc-style blocks and `///` above a
 * declaration, Rust `//!`, and Python docstrings. Tools render these without
 * the body, so they document an API rather than the code beside them.
 */
export const DocCommentSchema = z.object({
  /** A declaration, or the package, module, or crate the comment opens. */
  target: z.enum(["declaration", "module"]),
  /** The declared name, or the package name for a Go `package` clause. Null when the line did not parse. */
  subject: z.string().nullable(),
  /** Visible outside its package or module. */
  exported: z.boolean(),
  /** The language's standard tooling expects this comment to exist: godoc on exported Go identifiers and packages. */
  required: z.boolean(),
});

export type DocComment = z.infer<typeof DocCommentSchema>;

const GO_PACKAGE = /^package\s+(\w+)/;
const GO_DECL = /^(?:func\s+(?:\([^)]*\)\s*)?|(?:type|var|const)\s+)(\w+)/;
const GO_GROUP = /^(?:type|var|const)\s*\(\s*$/;
const GO_SPEC = /^\s+(\w+)\b/;

const RUST_ITEM =
  /^(pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*(?:fn|struct|enum|trait|type|mod|const|static|union|macro_rules!)\s*(\w+)/;

const JS_DECL =
  /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var|namespace)\s+([\w$]+)/;
const JS_MEMBER =
  /^((?:(?:public|private|protected|static|readonly|abstract|override|async|get|set)\s+)*)(#?[\w$]+)\s*[(<:=?!]/;

const C_FAMILY_KEYWORD =
  /\b(?:class|interface|enum|struct|record|object|trait|protocol|fun|func|def|function|typealias|namespace)\s+(\w+)/;
const C_FAMILY_CALL = /(\w+)\s*(?:<[^>]*>)?\s*\(/;
const C_FAMILY_FIELD = /(\w+)\s*(?:[=;:]|$)/;

const C_FAMILY = new Set<Language>([
  "java",
  "kotlin",
  "scala",
  "csharp",
  "swift",
  "dart",
  "php",
  "c",
  "cpp",
]);

const PYTHON_DEF = /^(?:async\s+)?(?:def|class)\s+(\w+)/;

const isBlank = (line: string | undefined): boolean => (line ?? "").trim() === "";

function ownsLines(comment: Comment, lines: string[]): boolean {
  const before = (lines[comment.startLine - 1] ?? "").slice(0, comment.startColumn);
  const after = (lines[comment.endLine - 1] ?? "").slice(comment.endColumn);
  return before.trim() === "" && after.trim() === "";
}

function declarationAfter(comment: Comment, lines: string[], skip: RegExp | null): string | null {
  for (let i = comment.endLine; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isBlank(line)) return null;
    if (skip?.test(line.trim())) continue;
    return line;
  }
  return null;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

function enclosingOpener(lines: string[], index: number, indent: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!isBlank(line) && indentOf(line) < indent) return line;
  }
  return null;
}

const goExported = (name: string): boolean => /^\p{Lu}/u.test(name);

function goDoc(comment: Comment, lines: string[]): DocComment | null {
  const next = declarationAfter(comment, lines, null);
  if (next == null) return null;
  const pkg = GO_PACKAGE.exec(next);
  if (pkg) return { target: "module", subject: pkg[1] ?? null, exported: true, required: true };
  const decl = GO_DECL.exec(next);
  if (decl?.[1] != null) {
    const exported = goExported(decl[1]);
    return { target: "declaration", subject: decl[1], exported, required: exported };
  }
  const spec = GO_SPEC.exec(next);
  if (spec?.[1] == null) return null;
  const opener = enclosingOpener(lines, comment.startLine - 1, indentOf(next));
  if (opener == null) return null;
  const exported = goExported(spec[1]);
  // A grouped const, var, or type spec is linted like a top-level one. A struct field or interface method is not.
  if (GO_GROUP.test(opener)) {
    return { target: "declaration", subject: spec[1], exported, required: exported };
  }
  if (/\b(?:struct|interface)\s*\{\s*$/.test(opener)) {
    return { target: "declaration", subject: spec[1], exported, required: false };
  }
  return null;
}

function rustDoc(comment: Comment, lines: string[]): DocComment | null {
  const text = comment.text.trimStart();
  if (/^(?:\/\/!|\/\*!)/.test(text)) {
    return { target: "module", subject: null, exported: true, required: false };
  }
  if (!/^(?:\/\/\/(?!\/)|\/\*\*(?![*/]))/.test(text)) return null;
  const next = declarationAfter(comment, lines, /^#!?\[/);
  if (next == null) return null;
  const item = RUST_ITEM.exec(next.trim());
  const exported = /^pub\s/.test(next.trim());
  return { target: "declaration", subject: item?.[2] ?? null, exported, required: false };
}

function jsDoc(comment: Comment, lines: string[]): DocComment | null {
  if (!/^\/\*\*(?![*/])/.test(comment.text.trimStart())) return null;
  const next = declarationAfter(comment, lines, /^@\w/);
  if (next == null) return null;
  const trimmed = next.trim();
  const decl = JS_DECL.exec(trimmed);
  if (decl) {
    return {
      target: "declaration",
      subject: decl[2] ?? null,
      exported: decl[1] != null,
      required: false,
    };
  }
  const member = JS_MEMBER.exec(trimmed);
  const name = member?.[2] ?? null;
  const exported = name != null && !name.startsWith("#") && !/\bprivate\b/.test(member?.[1] ?? "");
  return { target: "declaration", subject: name, exported, required: false };
}

function cFamilyExported(language: Language, line: string, name: string | null): boolean {
  if (/\b(?:private|fileprivate|internal)\b/.test(line)) return false;
  switch (language) {
    case "java":
    case "csharp":
    case "php":
    case "swift":
      return /\b(?:public|open|protected)\b/.test(line);
    case "dart":
      return name == null || !name.startsWith("_");
    default:
      return true;
  }
}

function cFamilyDoc(comment: Comment, lines: string[], language: Language): DocComment | null {
  const text = comment.text.trimStart();
  const slashes = language !== "java" && language !== "kotlin" && language !== "scala";
  const isDoc = /^\/\*\*(?![*/])/.test(text) || (slashes && /^\/\/\/(?!\/)/.test(text));
  if (!isDoc) return null;
  const next = declarationAfter(comment, lines, /^(?:@\w|\[\w)/);
  if (next == null) return null;
  const trimmed = next.trim();
  const name =
    C_FAMILY_KEYWORD.exec(trimmed)?.[1] ??
    C_FAMILY_CALL.exec(trimmed)?.[1] ??
    C_FAMILY_FIELD.exec(trimmed)?.[1] ??
    null;
  return {
    target: "declaration",
    subject: name,
    exported: cFamilyExported(language, trimmed, name),
    required: false,
  };
}

function pythonDoc(comment: Comment, lines: string[]): DocComment | null {
  if (comment.kind !== "docstring") return null;
  let significant = false;
  // Walks up past a multi-line signature to its `def` or `class` line.
  for (let i = comment.startLine - 2; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "" && significant) break;
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    significant = true;
    const name = PYTHON_DEF.exec(trimmed)?.[1];
    if (name == null) continue;
    const exported = !name.startsWith("_") || /^__\w+__$/.test(name);
    return { target: "declaration", subject: name, exported, required: false };
  }
  return significant
    ? { target: "declaration", subject: null, exported: true, required: false }
    : { target: "module", subject: null, exported: true, required: false };
}

/**
 * `exported` is approximate where the language's visibility needs a parser
 * (a member of an unexported class reads as exported).
 */
export function docCommentOf(
  comment: Comment,
  lines: string[],
  language: Language,
): DocComment | null {
  if (language === "python") return pythonDoc(comment, lines);
  if (!ownsLines(comment, lines)) return null;
  if (language === "go") return goDoc(comment, lines);
  if (language === "rust") return rustDoc(comment, lines);
  if (language === "typescript" || language === "tsx" || language === "javascript") {
    return jsDoc(comment, lines);
  }
  if (C_FAMILY.has(language)) return cFamilyDoc(comment, lines, language);
  return null;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * The lead a Go doc comment opens with: `Package name` for a package clause,
 * the declared name (optionally after an article) for a declaration. Null when
 * there is no subject to anchor on.
 */
export function goDocLead(doc: DocComment): RegExp | null {
  if (doc.subject == null) return null;
  const name = escapeRegExp(doc.subject);
  return doc.target === "module"
    ? new RegExp(`^Package\\s+${name}\\b`)
    : new RegExp(`^(?:(?:A|An|The)\\s+)?${name}\\b`);
}
