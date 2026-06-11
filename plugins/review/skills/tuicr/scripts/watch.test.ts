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
  test("returns only comments whose IDs are not yet seen", () => {
    const seen = new Set(["c1"]);
    const comments = [comment({ id: "c1" }), comment({ id: "c2" })];
    expect(newComments(seen, comments).map((c) => c.id)).toEqual(["c2"]);
  });

  test("skips comments without an ID", () => {
    const comments = [comment({ id: "" }), comment({ id: "c2" })];
    expect(newComments(new Set(), comments).map((c) => c.id)).toEqual(["c2"]);
  });

  test("returns nothing when all are seen", () => {
    const comments = [comment({ id: "c1" }), comment({ id: "c2" })];
    expect(newComments(new Set(["c1", "c2"]), comments)).toEqual([]);
  });
});
