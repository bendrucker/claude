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

  test("changes when the path changes", () => {
    expect(commentId("a.ts", comment())).not.toBe(commentId("b.ts", comment()));
  });

  test("changes when the text changes", () => {
    expect(commentId("a.ts", comment())).not.toBe(
      commentId("a.ts", comment({ text: "// different" })),
    );
  });

  test("changes when the position changes", () => {
    expect(commentId("a.ts", comment())).not.toBe(commentId("a.ts", comment({ startLine: 6 })));
    expect(commentId("a.ts", comment())).not.toBe(commentId("a.ts", comment({ startColumn: 4 })));
  });
});
