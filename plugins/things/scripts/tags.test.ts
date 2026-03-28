import { describe, expect, test } from "bun:test";
import { mergeTags, parseTags } from "./tags";

describe("parseTags", () => {
  test("returns empty array for undefined", () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseTags("")).toEqual([]);
  });

  test("parses single tag", () => {
    expect(parseTags("claude-code")).toEqual(["claude-code"]);
  });

  test("parses comma-separated tags", () => {
    expect(parseTags("claude-code,work")).toEqual(["claude-code", "work"]);
  });

  test("trims whitespace", () => {
    expect(parseTags(" claude-code , work ")).toEqual(["claude-code", "work"]);
  });

  test("filters empty segments", () => {
    expect(parseTags("claude-code,,work")).toEqual(["claude-code", "work"]);
  });
});

describe("mergeTags", () => {
  test("returns single source as-is", () => {
    expect(mergeTags(["Claude"])).toEqual(["Claude"]);
  });

  test("combines multiple sources", () => {
    expect(mergeTags(["Claude"], ["work"])).toEqual(["Claude", "work"]);
  });

  test("deduplicates across sources", () => {
    expect(mergeTags(["Claude"], ["Claude", "work"])).toEqual(["Claude", "work"]);
  });

  test("preserves insertion order", () => {
    expect(mergeTags(["Claude", "claude-code"], ["work"])).toEqual([
      "Claude",
      "claude-code",
      "work",
    ]);
  });

  test("handles empty sources", () => {
    expect(mergeTags([], ["Claude"])).toEqual(["Claude"]);
  });
});
