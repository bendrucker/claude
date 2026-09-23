import { describe, expect, test } from "bun:test";
import { type DocComment, docCommentOf, docLead } from "./doc";
import { extractComments } from "./extract";
import type { Language } from "./types";

async function classify(source: string, language: Language): Promise<Record<string, unknown>> {
  const lines = source.split("\n");
  const comments = await extractComments(source, language);
  return Object.fromEntries(
    comments.map((comment) => [
      comment.text.split("\n")[0] ?? "",
      docCommentOf(comment, lines, language),
    ]),
  );
}

describe("docCommentOf", () => {
  test("Go", async () => {
    const source = [
      "// Package command holds shared helpers.",
      "package command",
      "",
      "// EnumUsage renders allowed values.",
      "func EnumUsage() {}",
      "",
      "// ConfirmDelete reports whether a delete should proceed.",
      "//",
      "// A second paragraph.",
      "func (c *T) ConfirmDelete() {}",
      "",
      "// knownMethod reports whether s is known.",
      "func knownMethod() {}",
      "",
      "// Field describes one input.",
      "type Field struct {",
      "\t// Prompt is shown when prompting.",
      "\tPrompt string",
      "}",
      "",
      "const (",
      "\t// ModeFast skips checks.",
      "\tModeFast = 1",
      "\t// modeSlow runs them.",
      "\tmodeSlow = 2",
      ")",
      "",
      "// detached from what follows",
      "",
      "func other() {",
      "\t// a statement comment",
      "\tx := 1",
      "}",
    ].join("\n");
    expect(await classify(source, "go")).toMatchSnapshot();
  });

  test("Rust", async () => {
    const source = [
      "//! Crate docs.",
      "",
      "/// Adds two numbers.",
      "#[inline]",
      "pub fn add() {}",
      "",
      "/// Private helper.",
      "fn helper() {}",
      "",
      "// plain",
      "struct S;",
    ].join("\n");
    expect(await classify(source, "rust")).toMatchSnapshot();
  });

  test("TypeScript", async () => {
    const source = [
      "/**",
      " * Adds.",
      " * @param a the left operand",
      " */",
      "export function add(a: number) {}",
      "",
      "class C {",
      "  /** Private state. */",
      "  private count = 0;",
      "  /** Public method. */",
      "  run(): void {}",
      "}",
      "",
      "/* plain block */",
      "const x = 1;",
    ].join("\n");
    expect(await classify(source, "typescript")).toMatchSnapshot();
  });

  test("Java and Kotlin", async () => {
    const java = ["/**", " * Adds.", " */", "@Override", "public int add() {}"].join("\n");
    const kotlin = ["/** Adds. */", "internal fun add() {}"].join("\n");
    expect({
      java: await classify(java, "java"),
      kotlin: await classify(kotlin, "kotlin"),
    }).toMatchSnapshot();
  });

  test("Python", async () => {
    const source = [
      '"""Module docs."""',
      "",
      "def _private(",
      "    a: int,",
      ") -> int:",
      '    """Private helper."""',
      "",
      "class Public:",
      '    """Public class."""',
      "",
      "    def __init__(self):",
      '        """Dunder."""',
    ].join("\n");
    expect(await classify(source, "python")).toMatchSnapshot();
  });
});

describe("docLead", () => {
  const doc = (target: DocComment["target"], subject: string): DocComment => ({
    target,
    subject,
    exported: true,
    required: true,
  });

  test.each([
    ["declaration", "ConfirmDelete", "ConfirmDelete reports whether", true],
    ["declaration", "Field", "A Field describes one input", true],
    ["declaration", "ConfirmDelete", "Reports whether a delete should proceed", false],
    ["declaration", "Field", "Fields describe inputs", false],
    ["module", "command", "Package command holds helpers", true],
    ["module", "command", "Command holds helpers", false],
  ] as const)("%s %s: %s", (target, subject, prose, matches) => {
    expect(docLead(doc(target, subject))?.test(prose)).toBe(matches);
  });
});
