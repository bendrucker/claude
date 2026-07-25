import { describe, expect, it, test } from "bun:test";
import type { Operation } from "rfc6902";
import { applyOverlay, findOverlayConflicts, getPointer, type OverlayConflict } from "./overlay";

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
  const nested = { a: { "b/c": { "~x": 1 } } };
  test.each<[unknown, string, unknown]>([
    [nested, "/a/b~1c/~0x", 1],
    [nested, "", nested],
    [{ a: 1 }, "/a/b", undefined],
    [{}, "/missing", undefined],
  ])("getPointer(%p, %p) is %p", (value, pointer, expected) => {
    expect(getPointer(value, pointer)).toEqual(expected);
  });
});

describe("findOverlayConflicts", () => {
  const changedReplace: Operation = { op: "replace", path: "/$id", value: "mine" };
  const removeOp: Operation = { op: "remove", path: "/properties/gone" };

  test.each<[string, Record<string, unknown>, Operation[], OverlayConflict[]]>([
    [
      "flags an op the base already satisfies as absorbed",
      { properties: { theme: { type: "string" }, name: { type: "string" } } },
      [
        { op: "add", path: "/properties/theme", value: { type: "string" } },
        { op: "add", path: "/properties/extra", value: { type: "boolean" } },
      ],
      [{ index: 0, path: "/properties/theme", kind: "absorbed" }],
    ],
    [
      "flags an add over a richer upstream definition as diverged",
      { properties: { theme: { type: "string", enum: ["dark", "light"] } } },
      [{ op: "add", path: "/properties/theme", value: { type: "string" } }],
      [{ index: 0, path: "/properties/theme", kind: "diverged" }],
    ],
    ["does not flag a replace that changes the value", { $id: "upstream" }, [changedReplace], []],
    ["ignores remove operations", { properties: {} }, [removeOp], []],
    [
      "ignores an add whose target is absent upstream",
      { properties: {} },
      [{ op: "add", path: "/properties/new", value: { type: "boolean" } }],
      [],
    ],
  ])("%s", (_name, base, patch, expected) => {
    expect(findOverlayConflicts(base, patch)).toEqual(expected);
  });
});
