import { describe, expect, test } from "bun:test";
import { buildJsonPayload, coerceBooleanAttributes } from "./url";

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
      attributes: { when: "today", "add-tags": "Urgent" },
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
});

describe("coerceBooleanAttributes", () => {
  test("coerces all known boolean attributes", () => {
    const result = coerceBooleanAttributes({
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
    const result = coerceBooleanAttributes({ when: "today", "add-tags": "Urgent" });
    expect(result).toEqual({ when: "today", "add-tags": "Urgent" });
  });

  test("does not coerce non-boolean values for boolean attributes", () => {
    const result = coerceBooleanAttributes({ completed: "yes" });
    expect(result).toEqual({ completed: "yes" });
  });
});
