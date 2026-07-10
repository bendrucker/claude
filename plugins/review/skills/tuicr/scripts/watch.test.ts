import { describe, expect, test } from "bun:test";
import type { TuicrComment } from "./comment";
import { describeComment, newComments, oneLine } from "./watch";

function comment(overrides: Partial<TuicrComment>): TuicrComment {
  return {
    id: "c1",
    location: "user/settings.json:150",
    path: "user/settings.json",
    start_line: 150,
    end_line: null,
    side: "new",
    comment_type: "issue",
    lifecycle_state: "local_draft",
    content: "comment",
    ...overrides,
  };
}

describe("oneLine", () => {
  test("collapses whitespace runs and trims", () => {
    expect(oneLine("  line one\n  line two\t three ")).toBe("line one line two three");
  });
});

describe("describeComment", () => {
  test("formats a Monitor event line", () => {
    expect(describeComment(comment({ location: "a.ts:10", content: "fix\nthis" }))).toBe(
      "NEW a.ts:10 | fix this",
    );
  });
});

describe("newComments", () => {
  test.each<[string, string[], string[], string[]]>([
    ["returns only comments whose IDs are not yet seen", ["c1"], ["c1", "c2"], ["c2"]],
    ["skips comments without an ID", [], ["", "c2"], ["c2"]],
    ["returns nothing when all are seen", ["c1", "c2"], ["c1", "c2"], []],
  ])("%s", (_name, seenIds, commentIds, expected) => {
    const seen = new Set(seenIds);
    const comments = commentIds.map((id) => comment({ id }));
    expect(newComments(seen, comments).map((c) => c.id)).toEqual(expected);
  });
});
