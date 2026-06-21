import { describe, expect, it } from "bun:test";
import type { Operation } from "rfc6902";
import { applyOverlay, findRedundantOps, getPointer } from "./overlay";

describe("applyOverlay", () => {
  it("adds and replaces without mutating the base", () => {
    const base = { $id: "upstream", properties: { name: { type: "string" } } };
    const patch: Operation[] = [
      { op: "replace", path: "/$id", value: "mine" },
      { op: "add", path: "/properties/theme", value: { type: "string" } },
    ];

    const merged = applyOverlay(base, patch);

    expect(merged).toEqual({
      $id: "mine",
      properties: { name: { type: "string" }, theme: { type: "string" } },
    });
    expect(base.$id).toBe("upstream");
    expect(base.properties).not.toHaveProperty("theme");
  });

  it("throws when an operation targets a missing path", () => {
    const base = { properties: {} };
    const patch: Operation[] = [{ op: "add", path: "/properties/a/b/c", value: 1 }];
    expect(() => applyOverlay(base, patch)).toThrow(/overlay failed to apply/);
  });
});

describe("getPointer", () => {
  it("resolves nested paths and decodes escapes", () => {
    const value = { a: { "b/c": { "~x": 1 } } };
    expect(getPointer(value, "/a/b~1c/~0x")).toBe(1);
    expect(getPointer(value, "")).toBe(value);
  });

  it("returns undefined for missing segments", () => {
    expect(getPointer({ a: 1 }, "/a/b")).toBeUndefined();
    expect(getPointer({}, "/missing")).toBeUndefined();
  });
});

describe("findRedundantOps", () => {
  it("flags add/replace ops the base already satisfies", () => {
    const base = { properties: { theme: { type: "string" }, name: { type: "string" } } };
    const patch: Operation[] = [
      { op: "add", path: "/properties/theme", value: { type: "string" } },
      { op: "add", path: "/properties/extra", value: { type: "boolean" } },
    ];

    const redundant = findRedundantOps(base, patch);

    expect(redundant).toEqual([{ index: 0, path: "/properties/theme" }]);
  });

  it("does not flag a replace that changes the value", () => {
    const base = { $id: "upstream" };
    const patch: Operation[] = [{ op: "replace", path: "/$id", value: "mine" }];
    expect(findRedundantOps(base, patch)).toEqual([]);
  });

  it("ignores remove operations", () => {
    const base = { properties: {} };
    const patch: Operation[] = [{ op: "remove", path: "/properties/gone" }];
    expect(findRedundantOps(base, patch)).toEqual([]);
  });
});
