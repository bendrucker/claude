import { describe, expect, test } from "bun:test";
import { modelLetter } from "./model";

describe("modelLetter", () => {
  test.each<[string, string | null, string | null]>([
    ["claude-opus-4-8", null, "O"],
    ["claude-opus-4-8[1m]", null, "O"],
    ["claude-sonnet-5", null, "S"],
    ["claude-haiku-4-5-20251001", null, "H"],
    ["claude-fable-5", null, "F"],
    ["claude-newmodel-1", "NewModel 1", "N"],
    ["", "Opus", "O"],
    ["", "", null],
    ["", null, null],
  ])("id %p / name %p -> %p", (id, name, expected) => {
    expect(modelLetter(id, name)).toBe(expected);
  });

  test("undefined id falls back to display name", () => {
    expect(modelLetter(undefined, "Haiku")).toBe("H");
  });
});
