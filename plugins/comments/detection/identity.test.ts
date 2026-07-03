import { describe, expect, test } from "bun:test";
import { commentId } from "./identity";
import type { Comment } from "./types";

function comment(over: Partial<Comment> = {}): Comment {
  return {
    kind: "line",
    text: "// increment the counter",
    startLine: 5,
    endLine: 5,
    startColumn: 2,
    endColumn: 26,
    ...over,
  };
}

describe("commentId", () => {
  test("is a stable truncated hex digest", () => {
    expect(commentId("a.ts", comment())).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is stable across re-extraction of the same comment", () => {
    expect(commentId("a.ts", comment())).toBe(commentId("a.ts", comment()));
  });

  const baseline = commentId("a.ts", comment());

  test.each<{ name: string; path: string; override?: Partial<Comment> }>([
    { name: "path", path: "b.ts" },
    { name: "text", path: "a.ts", override: { text: "// different" } },
    { name: "startLine", path: "a.ts", override: { startLine: 6 } },
    { name: "startColumn", path: "a.ts", override: { startColumn: 4 } },
  ])("changes when the $name changes", ({ path, override }) => {
    expect(commentId(path, comment(override))).not.toBe(baseline);
  });
});
