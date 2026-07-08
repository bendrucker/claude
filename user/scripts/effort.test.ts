import { describe, expect, test } from "bun:test";
import { effortGlyph } from "./effort";

describe("effortGlyph", () => {
  test.each<[string | null | undefined, string | null]>([
    ["low", "⠂"],
    ["medium", "⠆"],
    ["high", "⠇"],
    ["xhigh", "⠧"],
    ["max", "⠿"],
    ["unknown", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("level %p -> %p", (level, expected) => {
    expect(effortGlyph(level)).toBe(expected);
  });
});
