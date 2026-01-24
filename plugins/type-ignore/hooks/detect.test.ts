import { describe, expect, it } from "vitest";
import { findIgnorePattern, findLineNumber, hasNewIgnore } from "./detect";

describe("detect", () => {
  describe("findIgnorePattern", () => {
    it("detects @ts-ignore", () => {
      expect(findIgnorePattern("// @ts-ignore", "typescript")).toBe("@ts-ignore");
    });

    it("detects @ts-expect-error", () => {
      expect(findIgnorePattern("// @ts-expect-error", "typescript")).toBe("@ts-expect-error");
    });

    it("detects eslint-disable", () => {
      expect(findIgnorePattern("// eslint-disable", "typescript")).toBe("eslint-disable");
    });

    it("detects eslint-disable-next-line", () => {
      expect(findIgnorePattern("// eslint-disable-next-line", "typescript")).toBe(
        "eslint-disable-next-line",
      );
    });

    it("detects # type: ignore", () => {
      expect(findIgnorePattern("# type: ignore", "python")).toBe("# type: ignore");
    });

    it("detects # noqa", () => {
      expect(findIgnorePattern("# noqa", "python")).toBe("# noqa");
    });

    it("returns null for clean TypeScript", () => {
      expect(findIgnorePattern("const x = 1;", "typescript")).toBeNull();
    });

    it("returns null for clean Python", () => {
      expect(findIgnorePattern("x = 1", "python")).toBeNull();
    });
  });

  describe("hasNewIgnore", () => {
    it("detects new TypeScript ignore", () => {
      expect(hasNewIgnore("const x = 1;", "// @ts-ignore\nconst x = 1;", "typescript")).toBe(
        "@ts-ignore",
      );
    });

    it("returns null when ignore already existed", () => {
      expect(
        hasNewIgnore("// @ts-ignore\nconst x = 1;", "// @ts-ignore\nconst y = 2;", "typescript"),
      ).toBeNull();
    });

    it("detects new Python ignore", () => {
      expect(hasNewIgnore("x = 1", "x = 1  # type: ignore", "python")).toBe("# type: ignore");
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
