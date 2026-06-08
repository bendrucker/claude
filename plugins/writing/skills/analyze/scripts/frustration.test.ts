import { describe, expect, test } from "bun:test";
import { FRUSTRATION_TERMS, frustrationRegex } from "./frustration";

describe("frustrationRegex", () => {
  test("matches single-word and multi-word terms with boundaries", () => {
    const re = new RegExp(frustrationRegex(), "i");
    expect(re.test("ugh this is gross")).toBe(true);
    expect(re.test("that reads like marketing copy")).toBe(true);
    expect(re.test("cut the fluff please")).toBe(true);
  });

  test("does not match terms embedded in larger words", () => {
    const re = new RegExp(frustrationRegex(["stop"]), "i");
    expect(re.test("the build stopped")).toBe(false);
    expect(re.test("please stop")).toBe(true);
  });

  test("escapes regex metacharacters in custom terms", () => {
    const re = new RegExp(frustrationRegex(["a.b"]), "i");
    expect(re.test("axb")).toBe(false);
    expect(re.test("a.b")).toBe(true);
  });

  test("the default lexicon is non-empty and covers known gripes", () => {
    expect(FRUSTRATION_TERMS).toContain("flowery");
    expect(FRUSTRATION_TERMS).toContain("clanker");
    expect(FRUSTRATION_TERMS).toContain("reads like");
  });
});
