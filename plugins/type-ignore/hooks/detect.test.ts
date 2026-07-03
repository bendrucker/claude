import { describe, expect, test } from "bun:test";
import { findIgnorePattern, findLineNumber, hasNewIgnore } from "./detect";

type Ignore = { label: string; match: string } | null;
const ignore = (label: string, match = label): Ignore => ({ label, match });

describe("detect", () => {
  describe("findIgnorePattern", () => {
    test.each<[string, string, string, Ignore]>([
      ["detects @ts-ignore", "// @ts-ignore", "typescript", ignore("@ts-ignore")],
      ["detects @ts-expect-error", "// @ts-expect-error", "typescript", ignore("@ts-expect-error")],
      ["detects eslint-disable", "// eslint-disable", "typescript", ignore("eslint-disable")],
      [
        "detects eslint-disable-next-line",
        "// eslint-disable-next-line",
        "typescript",
        ignore("eslint-disable", "eslint-disable-next-line"),
      ],
      [
        "detects biome-ignore",
        "// biome-ignore lint: reason",
        "typescript",
        ignore("biome-ignore"),
      ],
      ["returns null for clean TypeScript", "const x = 1;", "typescript", null],
      [
        "detects # type: ignore",
        "# type: ignore",
        "python",
        ignore("type: ignore", "# type: ignore"),
      ],
      ["detects # noqa", "# noqa", "python", ignore("noqa", "# noqa")],
      [
        "detects # pylint: disable",
        "# pylint: disable=C0111",
        "python",
        ignore("pylint: disable", "# pylint: disable"),
      ],
      ["returns null for clean Python", "x = 1", "python", null],
      ["detects //nolint", "//nolint", "go", ignore("nolint", "//nolint")],
      ["detects //nolint:errcheck", "//nolint:errcheck", "go", ignore("nolint", "//nolint")],
      ["does not match // nolint with space", "// nolint", "go", null],
      ["detects //lint:ignore", "//lint:ignore", "go", ignore("lint:ignore", "//lint:ignore")],
      ["returns null for clean Go", "func main() {}", "go", null],
      [
        "detects #[allow(unused)]",
        "#[allow(unused)]",
        "rust",
        ignore("#[allow(...)]", "#[allow(unused)]"),
      ],
      [
        "detects #![allow(unused)] inner attribute",
        "#![allow(unused)]",
        "rust",
        ignore("#[allow(...)]", "#![allow(unused)]"),
      ],
      [
        "detects #[allow(clippy::complexity)]",
        "#[allow(clippy::complexity)]",
        "rust",
        ignore("#[allow(...)]", "#[allow(clippy::complexity)]"),
      ],
      ["returns null for clean Rust", "fn main() {}", "rust", null],
      [
        "detects # rubocop:disable",
        "# rubocop:disable Style/FrozenStringLiteral",
        "ruby",
        ignore("rubocop:disable", "# rubocop:disable"),
      ],
      ["returns null for clean Ruby", "def hello; end", "ruby", null],
    ])("%s", (_name, content, language, expected) => {
      expect(findIgnorePattern(content, language)).toEqual(expected);
    });
  });

  describe("hasNewIgnore", () => {
    test.each<[string, string, string, string, Ignore]>([
      [
        "detects new TypeScript ignore",
        "const x = 1;",
        "// @ts-ignore\nconst x = 1;",
        "typescript",
        ignore("@ts-ignore"),
      ],
      [
        "returns null when ignore already existed",
        "// @ts-ignore\nconst x = 1;",
        "// @ts-ignore\nconst y = 2;",
        "typescript",
        null,
      ],
      [
        "detects new Python ignore",
        "x = 1",
        "x = 1  # type: ignore",
        "python",
        ignore("type: ignore", "# type: ignore"),
      ],
      [
        "detects new Go ignore",
        "err := foo()",
        "err := foo() //nolint:errcheck",
        "go",
        ignore("nolint", "//nolint"),
      ],
      [
        "detects new Rust ignore",
        "fn foo() {}",
        "#[allow(unused)]\nfn foo() {}",
        "rust",
        ignore("#[allow(...)]", "#[allow(unused)]"),
      ],
      [
        "detects new Ruby ignore",
        "def foo; end",
        "# rubocop:disable\ndef foo; end",
        "ruby",
        ignore("rubocop:disable", "# rubocop:disable"),
      ],
    ])("%s", (_name, oldString, newString, language, expected) => {
      expect(hasNewIgnore(oldString, newString, language)).toEqual(expected);
    });
  });

  describe("findLineNumber", () => {
    test.each<[string, string, number]>([
      ["@ts-ignore\ncode", "@ts-ignore", 1],
      ["line1\nline2\n@ts-ignore\nline4", "@ts-ignore", 3],
      ["no pattern here", "@ts-ignore", 1],
    ])("finds %p in %p at line %d", (content, pattern, expected) => {
      expect(findLineNumber(content, pattern)).toBe(expected);
    });
  });
});
