import { describe, expect, test } from "bun:test";
import { type FormatResult, formatContent, renderTemplate } from "./format";

describe("renderTemplate", () => {
  test.each<[string, string, string]>([
    ["cat", "src/a.ts", "cat"],
    ["prettier --stdin-filepath {}", "src/a.ts", "prettier --stdin-filepath 'src/a.ts'"],
    ["fmt {} {}", "a b.py", "fmt 'a b.py' 'a b.py'"],
    ["fmt {}", "it's.py", "fmt 'it'\\''s.py'"],
  ])("%p with %p renders %p", (template, path, expected) => {
    expect(renderTemplate(template, path)).toBe(expected);
  });
});

describe("formatContent", () => {
  test.each<{ name: string; template: string; content: string; expected: FormatResult }>([
    {
      name: "passes content through an identity command",
      template: "cat",
      content: "line one\nline two\n",
      expected: { content: "line one\nline two\n", formatted: true },
    },
    {
      name: "returns the transforming command's stdout",
      template: "tr 'a-z' 'A-Z'",
      content: "hello\n",
      expected: { content: "HELLO\n", formatted: true },
    },
    {
      name: "substitutes {} with the path",
      template: "cat; printf '%s' {}",
      content: "content\n",
      expected: { content: "content\nsrc/a b.ts", formatted: true },
    },
    {
      name: "keeps the original content when the command exits non-zero",
      template: "echo mangled; echo broken >&2; exit 3",
      content: "original\n",
      expected: { content: "original\n", formatted: false, error: "exit 3: broken" },
    },
    {
      name: "keeps the original content when an exit-0 command emits nothing",
      template: "cat > /dev/null",
      content: "original\n",
      expected: {
        content: "original\n",
        formatted: false,
        error: "produced empty output for non-empty input",
      },
    },
  ])("$name", async ({ template, content, expected }) => {
    expect(await formatContent(template, "src/a b.ts", content)).toEqual(expected);
  });
});
