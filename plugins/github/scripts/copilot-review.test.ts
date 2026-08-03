import { describe, expect, test } from "bun:test";
import { ANGLES, buildPrompt, type Diff, splitPaths } from "./copilot-review";

describe("splitPaths", () => {
  // git only emits these intact with -z. Newline splitting turns each into a path that
  // does not exist, and the file silently drops out of the review.
  test.each([
    ["plain", "a.ts\0b.ts\0", ["a.ts", "b.ts"]],
    ["non-ascii", "café.ts\0", ["café.ts"]],
    ["newline in name", "we\nird.ts\0ok.ts\0", ["we\nird.ts", "ok.ts"]],
    ["no trailing separator", "only.ts", ["only.ts"]],
    ["empty", "", []],
  ])("%s", (_name, output, expected) => {
    expect(splitPaths(output)).toEqual(expected);
  });
});

describe("buildPrompt", () => {
  const diff: Diff = { base: "origin/main", patch: "@@ -1 +1 @@\n-old\n+new", files: ["a.ts"] };

  test("carries the diff, the focus, and the file body", () => {
    const prompt = buildPrompt(diff, new Map([["a.ts", "export const x = 1;"]]), [], "FOCUS HERE");

    expect(prompt).toContain("FOCUS HERE");
    expect(prompt).toContain("## Diff (against origin/main)");
    expect(prompt).toContain("+new");
    expect(prompt).toContain("### a.ts");
    expect(prompt).toContain("export const x = 1;");
    expect(prompt).toContain("Do NOT summarize the change");
  });

  test("names omitted files so the model knows its view is partial", () => {
    const prompt = buildPrompt(diff, new Map(), ["huge.ts"], "FOCUS");

    expect(prompt).toContain("Not included in full because of size: huge.ts");
    expect(prompt).not.toContain("## Full contents");
  });
});

describe("angles", () => {
  test("stay disjoint so extra calls buy coverage rather than agreement", () => {
    expect(ANGLES).toHaveLength(3);
    expect(new Set(ANGLES.map((angle) => angle.id)).size).toBe(3);
    for (const angle of ANGLES) {
      expect(angle.focus).toContain("Look ONLY for these two classes");
    }
  });
});
