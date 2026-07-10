import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPrompt, parseVerdict, sha256 } from "./judge";

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "trim",
    category: "restate-the-what",
    confidence: "high",
    rationale: "r",
    ...over,
  };
}

describe("parseVerdict", () => {
  test("accepts a keep verdict and defaults rewrite to null", () => {
    const v = parseVerdict(raw({ action: "keep", category: null }), "x");
    expect(v.action).toBe("keep");
    expect(v.rewrite).toBeNull();
  });

  test("accepts a rewrite verdict carrying non-empty rewrite text", () => {
    const v = parseVerdict(
      raw({ action: "rewrite", category: "voice", rewrite: "// the fact" }),
      "x",
    );
    expect(v.action).toBe("rewrite");
    expect(v.rewrite).toBe("// the fact");
  });

  test("drops rewrite text on a non-rewrite action by rejecting it", () => {
    expect(() => parseVerdict(raw({ action: "trim", rewrite: "// stray" }), "x")).toThrow(
      /only valid when action is "rewrite"/,
    );
  });

  test("requires non-empty rewrite text when the action is rewrite", () => {
    expect(() =>
      parseVerdict(raw({ action: "rewrite", category: "voice", rewrite: "" }), "x"),
    ).toThrow(/non-empty string/);
    expect(() => parseVerdict(raw({ action: "rewrite", category: "voice" }), "x")).toThrow(
      /non-empty string/,
    );
  });

  test("rejects an unknown action", () => {
    expect(() => parseVerdict(raw({ action: "delete" }), "x")).toThrow(/"action" must be one of/);
  });

  test("preserves suggestedFix and numeric trimToLines", () => {
    const v = parseVerdict(raw({ suggestedFix: "drop it", trimToLines: [1, "x", 3] }), "x");
    expect(v.suggestedFix).toBe("drop it");
    expect(v.trimToLines).toEqual([1, 3]);
  });
});

describe("sha256", () => {
  test("is stable and hex", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("hello")).not.toBe(sha256("world"));
  });
});

describe("loadPrompt", () => {
  test("returns text and matching sha256 for a written file", async () => {
    const path = join(import.meta.dirname, `prompt-test-${process.pid}.md`);
    const body = "# judge prompt\nScore each comment.\n";
    await Bun.write(path, body);
    try {
      const prompt = await loadPrompt(path);
      expect(prompt.text).toBe(body);
      expect(prompt.sha256).toBe(sha256(body));
    } finally {
      await Bun.file(path).delete();
    }
  });
});
