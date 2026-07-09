import { describe, expect, test } from "bun:test";
import { type EffortMarker, effortMarker } from "./effort";

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
