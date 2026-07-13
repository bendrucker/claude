import { describe, expect, test } from "bun:test";
import { chunk, updateAttributes } from "./tools";

describe("chunk", () => {
  test.each<[string, number[], number, number[][]]>([
    [
      "splits evenly",
      [1, 2, 3, 4],
      2,
      [
        [1, 2],
        [3, 4],
      ],
    ],
    ["keeps remainder", [1, 2, 3], 2, [[1, 2], [3]]],
    ["single chunk when under size", [1, 2], 250, [[1, 2]]],
    ["empty input", [], 2, []],
  ])("%s", (_name, items, size, expected) => {
    expect(chunk(items, size)).toEqual(expected);
  });
});

describe("updateAttributes", () => {
  test("maps tool args to URL scheme attribute strings", () => {
    expect(
      updateAttributes({
        title: "New title",
        append_notes: "more",
        when: "today",
        tags: ["a", "b"],
        add_tags: ["c"],
        checklist_items: ["one", "two"],
        completed: true,
        canceled: false,
      }),
    ).toEqual({
      title: "New title",
      "append-notes": "more",
      when: "today",
      tags: "a,b",
      "add-tags": "c",
      "checklist-items": "one\ntwo",
      completed: "true",
      canceled: "false",
    });
  });

  test("omits undefined fields", () => {
    expect(updateAttributes({})).toEqual({});
  });
});
