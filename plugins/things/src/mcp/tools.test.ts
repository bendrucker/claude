import { describe, expect, test } from "bun:test";
import { chunk, updateAttributes, validateCaptureTitles, validateIds } from "./tools";

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

describe("validateCaptureTitles", () => {
  test.each<[string, string | undefined, string[] | undefined]>([
    ["title only", "one", undefined],
    ["titles only", undefined, ["one", "two"]],
  ])("accepts %s", (_name, title, titles) => {
    expect(() => validateCaptureTitles(title, titles)).not.toThrow();
  });

  test.each<[string, string | undefined, string[] | undefined, string]>([
    ["both title and titles", "one", ["two"], "not both"],
    ["title with empty titles", "one", [], "not both"],
    ["neither", undefined, undefined, "title or titles is required"],
    ["empty title only", "", undefined, "title or titles is required"],
    ["empty titles only", undefined, [], "title or titles is required"],
  ])("rejects %s", (_name, title, titles, message) => {
    expect(() => validateCaptureTitles(title, titles)).toThrow(message);
  });
});

describe("validateIds", () => {
  test("accepts non-empty ids", () => {
    expect(() => validateIds(["abc", "def"])).not.toThrow();
  });

  test.each<[string, string[], string]>([
    ["empty string", ["abc", ""], 'ids[1] must be a non-empty string, got ""'],
    ["whitespace only", ["  "], 'ids[0] must be a non-empty string, got "  "'],
  ])("rejects %s", (_name, ids, message) => {
    expect(() => validateIds(ids)).toThrow(message);
  });
});
