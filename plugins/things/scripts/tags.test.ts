import { describe, expect, test } from "bun:test";
import { mergeTags, parseExtraTags } from "./tags";

describe("parseExtraTags", () => {
  test("returns empty array for undefined", () => {
    expect(parseExtraTags(undefined)).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseExtraTags("")).toEqual([]);
  });

  test("parses single tag", () => {
    expect(parseExtraTags("claude-code")).toEqual(["claude-code"]);
  });

  test("parses comma-separated tags", () => {
    expect(parseExtraTags("claude-code,work")).toEqual(["claude-code", "work"]);
  });

  test("trims whitespace", () => {
    expect(parseExtraTags(" claude-code , work ")).toEqual(["claude-code", "work"]);
  });

  test("filters empty segments", () => {
    expect(parseExtraTags("claude-code,,work")).toEqual(["claude-code", "work"]);
  });
});

describe("mergeTags", () => {
  test("returns Claude when no existing tags", () => {
    expect(mergeTags(undefined)).toBe("Claude");
  });

  test("prepends Claude to existing tags", () => {
    expect(mergeTags("Work")).toBe("Claude,Work");
  });

  test("deduplicates Claude in existing tags", () => {
    expect(mergeTags("Claude,Work")).toBe("Claude,Work");
  });

  test("puts base tags first even if Claude appears later", () => {
    expect(mergeTags("Work,Claude")).toBe("Claude,Work");
  });

  test("includes extra tags", () => {
    expect(mergeTags(undefined, ["claude-code"])).toBe("Claude,claude-code");
  });

  test("merges extra tags with existing tags", () => {
    expect(mergeTags("Work", ["claude-code"])).toBe("Claude,claude-code,Work");
  });

  test("deduplicates extra tags against existing", () => {
    expect(mergeTags("claude-code,Work", ["claude-code"])).toBe("Claude,claude-code,Work");
  });

  test("deduplicates Claude in extra tags", () => {
    expect(mergeTags(undefined, ["Claude", "work"])).toBe("Claude,work");
  });
});
