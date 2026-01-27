import { describe, expect, it } from "vitest";
import { findIgnorePattern, findLineNumber, hasNewIgnore } from "./detect";

describe("detect", () => {
  describe("findIgnorePattern", () => {
    describe("typescript", () => {
      it("detects @ts-ignore", () => {
        expect(findIgnorePattern("// @ts-ignore", "typescript")).toEqual({
          label: "@ts-ignore",
          match: "@ts-ignore",
        });
      });

      it("detects @ts-expect-error", () => {
        expect(findIgnorePattern("// @ts-expect-error", "typescript")).toEqual({
          label: "@ts-expect-error",
          match: "@ts-expect-error",
        });
      });

      it("detects eslint-disable", () => {
        expect(findIgnorePattern("// eslint-disable", "typescript")).toEqual({
          label: "eslint-disable",
          match: "eslint-disable",
        });
      });

      it("detects eslint-disable-next-line", () => {
        expect(findIgnorePattern("// eslint-disable-next-line", "typescript")).toEqual({
          label: "eslint-disable",
          match: "eslint-disable-next-line",
        });
      });

      it("detects biome-ignore", () => {
        expect(findIgnorePattern("// biome-ignore lint: reason", "typescript")).toEqual({
          label: "biome-ignore",
          match: "biome-ignore",
        });
      });

      it("returns null for clean TypeScript", () => {
        expect(findIgnorePattern("const x = 1;", "typescript")).toBeNull();
      });
    });

    describe("python", () => {
      it("detects # type: ignore", () => {
        expect(findIgnorePattern("# type: ignore", "python")).toEqual({
          label: "type: ignore",
          match: "# type: ignore",
        });
      });

      it("detects # noqa", () => {
        expect(findIgnorePattern("# noqa", "python")).toEqual({
          label: "noqa",
          match: "# noqa",
        });
      });

      it("detects # pylint: disable", () => {
        expect(findIgnorePattern("# pylint: disable=C0111", "python")).toEqual({
          label: "pylint: disable",
          match: "# pylint: disable",
        });
      });

      it("returns null for clean Python", () => {
        expect(findIgnorePattern("x = 1", "python")).toBeNull();
      });
    });

    describe("go", () => {
      it("detects //nolint", () => {
        expect(findIgnorePattern("//nolint", "go")).toEqual({
          label: "nolint",
          match: "//nolint",
        });
      });

      it("detects //nolint:errcheck", () => {
        expect(findIgnorePattern("//nolint:errcheck", "go")).toEqual({
          label: "nolint",
          match: "//nolint",
        });
      });

      it("does not match // nolint with space", () => {
        expect(findIgnorePattern("// nolint", "go")).toBeNull();
      });

      it("detects //lint:ignore", () => {
        expect(findIgnorePattern("//lint:ignore", "go")).toEqual({
          label: "lint:ignore",
          match: "//lint:ignore",
        });
      });

      it("returns null for clean Go", () => {
        expect(findIgnorePattern("func main() {}", "go")).toBeNull();
      });
    });

    describe("rust", () => {
      it("detects #[allow(unused)]", () => {
        expect(findIgnorePattern("#[allow(unused)]", "rust")).toEqual({
          label: "#[allow(...)]",
          match: "#[allow(unused)]",
        });
      });

      it("detects #![allow(unused)] inner attribute", () => {
        expect(findIgnorePattern("#![allow(unused)]", "rust")).toEqual({
          label: "#[allow(...)]",
          match: "#![allow(unused)]",
        });
      });

      it("detects #[allow(clippy::complexity)]", () => {
        expect(findIgnorePattern("#[allow(clippy::complexity)]", "rust")).toEqual({
          label: "#[allow(...)]",
          match: "#[allow(clippy::complexity)]",
        });
      });

      it("returns null for clean Rust", () => {
        expect(findIgnorePattern("fn main() {}", "rust")).toBeNull();
      });
    });

    describe("ruby", () => {
      it("detects # rubocop:disable", () => {
        expect(findIgnorePattern("# rubocop:disable Style/FrozenStringLiteral", "ruby")).toEqual({
          label: "rubocop:disable",
          match: "# rubocop:disable",
        });
      });

      it("returns null for clean Ruby", () => {
        expect(findIgnorePattern("def hello; end", "ruby")).toBeNull();
      });
    });
  });

  describe("hasNewIgnore", () => {
    it("detects new TypeScript ignore", () => {
      expect(hasNewIgnore("const x = 1;", "// @ts-ignore\nconst x = 1;", "typescript")).toEqual({
        label: "@ts-ignore",
        match: "@ts-ignore",
      });
    });

    it("returns null when ignore already existed", () => {
      expect(
        hasNewIgnore("// @ts-ignore\nconst x = 1;", "// @ts-ignore\nconst y = 2;", "typescript"),
      ).toBeNull();
    });

    it("detects new Python ignore", () => {
      expect(hasNewIgnore("x = 1", "x = 1  # type: ignore", "python")).toEqual({
        label: "type: ignore",
        match: "# type: ignore",
      });
    });

    it("detects new Go ignore", () => {
      expect(hasNewIgnore("err := foo()", "err := foo() //nolint:errcheck", "go")).toEqual({
        label: "nolint",
        match: "//nolint",
      });
    });

    it("detects new Rust ignore", () => {
      expect(hasNewIgnore("fn foo() {}", "#[allow(unused)]\nfn foo() {}", "rust")).toEqual({
        label: "#[allow(...)]",
        match: "#[allow(unused)]",
      });
    });

    it("detects new Ruby ignore", () => {
      expect(hasNewIgnore("def foo; end", "# rubocop:disable\ndef foo; end", "ruby")).toEqual({
        label: "rubocop:disable",
        match: "# rubocop:disable",
      });
    });
  });

  describe("findLineNumber", () => {
    it("finds pattern on first line", () => {
      expect(findLineNumber("@ts-ignore\ncode", "@ts-ignore")).toBe(1);
    });

    it("finds pattern on third line", () => {
      expect(findLineNumber("line1\nline2\n@ts-ignore\nline4", "@ts-ignore")).toBe(3);
    });

    it("returns 1 when pattern not found", () => {
      expect(findLineNumber("no pattern here", "@ts-ignore")).toBe(1);
    });
  });
});
