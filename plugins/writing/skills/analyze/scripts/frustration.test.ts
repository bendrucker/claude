import { describe, expect, test } from "bun:test";
import { FRUSTRATION_TERMS, frustrationRegex, GATED_TERMS, gatedRegex } from "./frustration";

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
    expect(FRUSTRATION_TERMS).toContain("jargon");
    expect(FRUSTRATION_TERMS).toContain("marketing");
  });

  test("sounds like is not in the primary lexicon (gated)", () => {
    expect(FRUSTRATION_TERMS).not.toContain("sounds like");
    const re = new RegExp(frustrationRegex(), "i");
    expect(re.test("sounds like a plan")).toBe(false);
  });
});

describe("gatedRegex", () => {
  test("sounds like is in the gated lexicon", () => {
    expect(GATED_TERMS).toContain("sounds like");
  });

  test("matches sounds like with word boundaries", () => {
    const re = new RegExp(gatedRegex(), "i");
    expect(re.test("that sounds like marketing copy")).toBe(true);
    expect(re.test("this is fine")).toBe(false);
  });
});
