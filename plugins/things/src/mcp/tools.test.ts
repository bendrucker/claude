import { describe, expect, test } from "bun:test";
import {
  chunk,
  limitItems,
  updateAttributes,
  validateCaptureTitles,
  validateNonBlank,
} from "./tools";

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
    ["whitespace title only", "  ", undefined, "title or titles is required"],
    ["a blank entry among titles", undefined, ["one", ""], "titles[1] must be a non-empty string"],
  ])("rejects %s", (_name, title, titles, message) => {
    expect(() => validateCaptureTitles(title, titles)).toThrow(message);
  });
});

describe("validateNonBlank", () => {
  test("accepts non-empty values", () => {
    expect(() => validateNonBlank(["abc", "def"], "ids")).not.toThrow();
  });

  test.each<[string, string[], string, string]>([
    ["empty string", ["abc", ""], "ids", 'ids[1] must be a non-empty string, got ""'],
    ["whitespace only", ["  "], "ids", 'ids[0] must be a non-empty string, got "  "'],
    ["names the field", [""], "titles", 'titles[0] must be a non-empty string, got ""'],
  ])("rejects %s", (_name, values, field, message) => {
    expect(() => validateNonBlank(values, field)).toThrow(message);
  });
});

describe("limitItems", () => {
  /** One todo-sized record, padded so a few hundred of them exceed the budget. */
  function todo(index: number) {
    return { id: `id-${index}`, name: `Todo ${index}`, notes: "x".repeat(200) };
  }

  const oversized = Array.from({ length: 400 }, (_, index) => todo(index));

  const guidance = "Pass a limit.";

  test("returns a small array untouched", () => {
    const items = [todo(0), todo(1)];
    expect(limitItems(items, guidance)).toBe(items);
  });

  test("returns a small object payload untouched", () => {
    const payload = { count: 1, items: [todo(0)] };
    expect(limitItems(payload, guidance)).toBe(payload);
  });

  test("passes through a payload with no item list", () => {
    expect(limitItems({ error: "nope" }, guidance)).toEqual({ error: "nope" });
  });

  test("drops items from the end of an oversized array", () => {
    const limited = limitItems(oversized, guidance) as {
      truncated: boolean;
      returned: number;
      total: number;
      note: string;
      items: unknown[];
    };

    expect(limited.truncated).toBe(true);
    expect(limited.total).toBe(400);
    expect(limited.returned).toBeLessThan(400);
    expect(limited.items).toEqual(oversized.slice(0, limited.returned));
    expect(limited.note).toBe(
      `${400 - limited.returned} of 400 items omitted to fit the response budget. ${guidance}`,
    );
  });

  test("keeps the other fields of an oversized object payload", () => {
    const limited = limitItems({ count: 400, items: oversized }, guidance) as {
      count: number;
      truncated: boolean;
      total: number;
    };

    expect(limited.count).toBe(400);
    expect(limited.truncated).toBe(true);
    expect(limited.total).toBe(400);
  });

  // Serialized size is what decides whether the framed JSON-RPC line fits a
  // proxy's 64KB read buffer.
  test.each<[string, unknown]>([
    ["array", oversized],
    ["object payload", { count: 400, items: oversized }],
  ])("holds %s under the budget", (_name, payload) => {
    expect(JSON.stringify(limitItems(payload, guidance)).length).toBeLessThanOrEqual(32_768);
  });
});
