import { describe, expect, test } from "bun:test";
import { type EffortMarker, effortGlyph, effortMarker } from "./effort";

describe("effortMarker", () => {
  test.each<[string | null | undefined, EffortMarker | null]>([
    ["low", { glyph: "∙", isDefault: false }],
    ["medium", { glyph: "⁚", isDefault: false }],
    ["high", { glyph: "⁝", isDefault: true }],
    ["xhigh", { glyph: "⁞", isDefault: false }],
    ["max", { glyph: "⁙", isDefault: false }],
    ["unknown", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("level %p -> %p", (level, expected) => {
    expect(effortMarker(level)).toEqual(expected);
  });
});

describe("effortGlyph", () => {
  test.each<[string | number | null | undefined, string | null]>([
    ["low", "∙"],
    ["high", "⁝"],
    ["max", "⁙"],
    ["unknown", null],
    [20_000, null],
    [0, null],
    [null, null],
    [undefined, null],
  ])("effort %p -> %p", (effort, expected) => {
    expect(effortGlyph(effort)).toBe(expected);
  });
});
