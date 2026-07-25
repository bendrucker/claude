import { describe, expect, test } from "bun:test";
import { type ModelMarker, modelMarker } from "./model";

describe("modelMarker", () => {
  test.each<[string, string | null, ModelMarker | null]>([
    ["claude-opus-5", null, { letter: "o", isDefault: true }],
    ["claude-opus-4-8", null, { letter: "o", isDefault: true }],
    ["claude-opus-4-8[1m]", null, { letter: "o", isDefault: true }],
    ["claude-sonnet-5", null, { letter: "s", isDefault: false }],
    ["claude-haiku-4-5-20251001", null, { letter: "h", isDefault: false }],
    ["claude-fable-5", null, { letter: "f", isDefault: false }],
    ["claude-newmodel-1", "NewModel 1", { letter: "n", isDefault: false }],
    ["claude-unknown-1", null, null],
    ["", "Opus", { letter: "o", isDefault: false }],
    ["", "", null],
    ["", null, null],
  ])("id %p / name %p -> %p", (id, name, expected) => {
    expect(modelMarker(id, name)).toEqual(expected);
  });

  test("undefined id falls back to display name", () => {
    expect(modelMarker(undefined, "Haiku")).toEqual({ letter: "h", isDefault: false });
  });
});
