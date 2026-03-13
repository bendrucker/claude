import { describe, expect, test } from "bun:test";
import { buildJsonPayload, coerceAttributes } from "./url";

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
    const expected = {
      type: "to-do",
      operation: "update",
      attributes: { when: "today", "add-tags": ["Urgent"] },
    };
    expect(result).toEqual([
      { ...expected, id: "A" },
      { ...expected, id: "B" },
      { ...expected, id: "C" },
    ]);
  });

  test("empty ID list throws", () => {
    expect(() => buildJsonPayload([], { when: "today" })).toThrow("At least one ID is required");
  });

  test("empty attributes throws", () => {
    expect(() => buildJsonPayload(["ABC"], {})).toThrow("At least one attribute is required");
  });

  test("coerces boolean attributes to actual booleans", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { completed: "true", canceled: "false" }));
    expect(result[0].attributes).toEqual({ completed: true, canceled: false });
  });

  test("leaves non-boolean attributes as strings", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { when: "today", completed: "true" }));
    expect(result[0].attributes).toEqual({ when: "today", completed: true });
  });

  test("coerces tags to string array", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { tags: "work,personal" }));
    expect(result[0].attributes).toEqual({ tags: ["work", "personal"] });
  });

  test("coerces checklist-items to structured objects", () => {
    const result = JSON.parse(
      buildJsonPayload(["ABC"], { "checklist-items": "Buy milk\nWalk dog" }),
    );
    expect(result[0].attributes).toEqual({
      "checklist-items": [
        { type: "checklist-item", attributes: { title: "Buy milk" } },
        { type: "checklist-item", attributes: { title: "Walk dog" } },
      ],
    });
  });
});

describe("coerceAttributes", () => {
  test("coerces all known boolean attributes", () => {
    const result = coerceAttributes({
      completed: "true",
      canceled: "false",
      reveal: "true",
      duplicate: "false",
    });
    expect(result).toEqual({
      completed: true,
      canceled: false,
      reveal: true,
      duplicate: false,
    });
  });

  test("passes through string attributes unchanged", () => {
    const result = coerceAttributes({ when: "today" });
    expect(result).toEqual({ when: "today" });
  });

  test("does not coerce non-boolean values for boolean attributes", () => {
    const result = coerceAttributes({ completed: "yes" });
    expect(result).toEqual({ completed: "yes" });
  });

  test("coerces tags to string array", () => {
    const result = coerceAttributes({ tags: "tag1, tag2, tag3" });
    expect(result).toEqual({ tags: ["tag1", "tag2", "tag3"] });
  });

  test("coerces add-tags to string array", () => {
    const result = coerceAttributes({ "add-tags": "Urgent" });
    expect(result).toEqual({ "add-tags": ["Urgent"] });
  });

  test("coerces checklist-items to structured objects", () => {
    const result = coerceAttributes({ "checklist-items": "Item 1\nItem 2" });
    expect(result).toEqual({
      "checklist-items": [
        { type: "checklist-item", attributes: { title: "Item 1" } },
        { type: "checklist-item", attributes: { title: "Item 2" } },
      ],
    });
  });
});
