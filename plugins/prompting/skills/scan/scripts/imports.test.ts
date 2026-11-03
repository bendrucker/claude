import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { importPaths, resolveImport } from "./imports";

describe("importPaths", () => {
  test.each([
    ["an import at line start", "@docs/a.md\n", ["docs/a.md"]],
    ["an import after whitespace", "See @docs/a.md for more.", ["docs/a.md"]],
    ["an escaped space", String.raw`@my\ notes.md`, ["my notes.md"]],
    ["a home import", "@~/.claude/x.md", ["~/.claude/x.md"]],
    ["an email address", "Mail me@example.com.", []],
    ["a quoted path", 'Load "@docs/a.md".', []],
    ["an inline code span", "Use `@docs/a.md` literally.", []],
    ["a double-backtick span", "Use `` `@a.md` @b.md `` here.", []],
    ["a backtick fence", "```md\n@docs/a.md\n```\n@b.md", ["b.md"]],
    ["a tilde fence", "~~~\n@docs/a.md\n```\n@c.md\n~~~\n@b.md", ["b.md"]],
    ["an unclosed fence", "@a.md\n```\n@b.md", ["a.md"]],
  ])("%s", (_label, text, expected) => {
    expect(importPaths(text)).toEqual(expected);
  });
});

describe("resolveImport", () => {
  test.each([
    ["relative to the importing file", "b.md", "/repo/docs/b.md"],
    ["a parent path", "../c.md", "/repo/c.md"],
    ["an absolute path", "/etc/x.md", "/etc/x.md"],
    ["the home directory", "~/x.md", join(homedir(), "x.md")],
  ])("resolves %s", (_label, path, expected) => {
    expect(resolveImport(path, "/repo/docs/a.md")).toBe(expected);
  });
});
