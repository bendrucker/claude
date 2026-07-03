import { describe, expect, test } from "bun:test";
import { decodeComments, deriveAnchor, type TuicrComment } from "./comment";

function comment(overrides: Partial<TuicrComment>): TuicrComment {
  return {
    id: "c1",
    location: "user/settings.json:150",
    path: "user/settings.json",
    start_line: null,
    end_line: null,
    side: null,
    comment_type: "issue",
    lifecycle_state: "local_draft",
    content: "comment",
    ...overrides,
  };
}

describe("deriveAnchor", () => {
  test.each<[string, Partial<TuicrComment>, ReturnType<typeof deriveAnchor>]>([
    [
      "uses the new side when tuicr stamps it",
      { start_line: 150, end_line: 150, side: "new" },
      { side: "new", line: 150, path: "user/settings.json" },
    ],
    [
      "uses the old side for a removed line",
      { path: "old.txt", start_line: 11, end_line: 11, side: "old" },
      { side: "old", line: 11, path: "old.txt" },
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(deriveAnchor(comment(overrides))).toEqual(expected);
  });

  test("defaults to the new side when side is omitted on a line comment", () => {
    expect(deriveAnchor(comment({ start_line: 5, end_line: 5, side: null })).side).toBe("new");
  });

  test("throws when the comment has no line anchor", () => {
    expect(() => deriveAnchor(comment({ path: null, start_line: null }))).toThrow(
      "comment has no anchor",
    );
  });
});

describe("decodeComments", () => {
  test.each<[string, unknown]>([
    ["decodes a bare array of comments", [comment({ id: "c1" })]],
    ["decodes a { comments: [...] } envelope", { comments: [comment({ id: "c1" })] }],
  ])("%s", (_name, payload) => {
    const comments = decodeComments(JSON.stringify(payload));
    expect(comments.map((c) => c.id)).toEqual(["c1"]);
  });
});
