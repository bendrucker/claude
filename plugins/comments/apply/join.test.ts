import { describe, expect, test } from "bun:test";
import type { Manifest, ManifestEntry } from "../judge/job";
import type { Verdict } from "../judge/schema";
import { collectVerdicts, hasDrifted, joinVerdicts, textAtRange } from "./join";

function entry(over: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    path: "a.ts",
    language: "typescript",
    kind: "line",
    text: "// hi",
    startLine: 2,
    endLine: 2,
    startColumn: 0,
    endColumn: 5,
    ...over,
  };
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    isSlop: true,
    category: "restate-the-what",
    confidence: "high",
    rationale: "r",
    ...over,
  };
}

function shard(entries: Array<{ id: string; verdict: Verdict }>): unknown {
  return { verdicts: entries };
}

describe("collectVerdicts", () => {
  test("folds shards into one id-keyed map", () => {
    const map = collectVerdicts([
      shard([{ id: "a", verdict: verdict() }]),
      shard([{ id: "b", verdict: verdict({ isSlop: false, category: null }) }]),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("b")?.isSlop).toBe(false);
  });

  test("rejects a duplicate id across shards", () => {
    expect(() =>
      collectVerdicts([
        shard([{ id: "a", verdict: verdict() }]),
        shard([{ id: "a", verdict: verdict() }]),
      ]),
    ).toThrow(/appears more than once/);
  });

  test("rejects a malformed verdict", () => {
    expect(() =>
      collectVerdicts([{ verdicts: [{ id: "a", verdict: { category: null } }] }]),
    ).toThrow(/isSlop/);
  });

  test("rejects a shard missing the verdicts array", () => {
    expect(() => collectVerdicts([{}])).toThrow(/"verdicts" array/);
  });
});

describe("joinVerdicts", () => {
  const manifest: Manifest = { a: entry(), b: entry({ path: "b.ts" }) };

  test("joins every manifest entry to its verdict", () => {
    const verdicts = new Map([
      ["a", verdict()],
      ["b", verdict({ isSlop: false, category: null })],
    ]);
    const joined = joinVerdicts(manifest, verdicts);
    expect(joined.map((j) => j.id)).toEqual(["a", "b"]);
  });

  test("rejects a verdict with no manifest entry", () => {
    const verdicts = new Map([
      ["a", verdict()],
      ["b", verdict()],
      ["c", verdict()],
    ]);
    expect(() => joinVerdicts(manifest, verdicts)).toThrow(/no manifest entry/);
  });

  test("rejects an incomplete join", () => {
    expect(() => joinVerdicts(manifest, new Map([["a", verdict()]]))).toThrow(/Missing verdicts/);
  });
});

describe("drift detection", () => {
  const source = "ab\n// hi\ncd";

  test("reads the current text at a recorded range", () => {
    expect(textAtRange(source, entry())).toBe("// hi");
  });

  test("is not drifted when the recorded text still sits at the range", () => {
    expect(hasDrifted(source, entry())).toBe(false);
  });

  test("is drifted when the text at the range changed", () => {
    expect(hasDrifted(source, entry({ text: "// bye" }))).toBe(true);
  });

  test("is drifted when the range falls outside the file", () => {
    expect(hasDrifted(source, entry({ startLine: 50, endLine: 50 }))).toBe(true);
  });
});
