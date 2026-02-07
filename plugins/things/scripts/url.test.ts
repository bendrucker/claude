import { describe, expect, test } from "bun:test";
import { buildJsonPayload } from "./url";

describe("buildJsonPayload", () => {
  test("single ID produces correct structure", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { when: "tomorrow" }));
    expect(result).toEqual([
      {
        type: "to-do",
        operation: "update",
        id: "ABC",
        attributes: { when: "tomorrow" },
      },
    ]);
  });

  test("multiple IDs produce one object per ID with same attributes", () => {
    const result = JSON.parse(
      buildJsonPayload(["A", "B", "C"], { when: "today", "add-tags": "Urgent" }),
    );
    expect(result).toEqual([
      { type: "to-do", operation: "update", id: "A", attributes: { when: "today", "add-tags": "Urgent" } },
      { type: "to-do", operation: "update", id: "B", attributes: { when: "today", "add-tags": "Urgent" } },
      { type: "to-do", operation: "update", id: "C", attributes: { when: "today", "add-tags": "Urgent" } },
    ]);
  });

  test("empty ID list throws", () => {
    expect(() => buildJsonPayload([], { when: "today" })).toThrow(
      "At least one ID is required",
    );
  });

  test("empty attributes throws", () => {
    expect(() => buildJsonPayload(["ABC"], {})).toThrow(
      "At least one attribute is required",
    );
  });
});
