import { describe, expect, test } from "bun:test";
import { commentId } from "../detection/identity";
import type { Comment } from "../detection/types";
import type { Verdict } from "../judge/schema";
import { collectVerdicts, matchVerdicts } from "./join";

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    isSlop: true,
    category: "restate-the-what",
    confidence: "high",
    rationale: "r",
    ...over,
  };
}

function comment(over: Partial<Comment> = {}): Comment {
  return {
    kind: "line",
    text: "// hi",
    startLine: 2,
    endLine: 2,
    startColumn: 0,
    endColumn: 5,
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

describe("matchVerdicts", () => {
  const path = "a.ts";
  const a = comment({ text: "// a", startLine: 1, endColumn: 4 });
  const b = comment({ text: "// b", startLine: 5, endColumn: 4 });

  test("matches a re-extracted comment to the verdict its id names", () => {
    const verdicts = new Map([[commentId(path, a), verdict()]]);
    const matches = matchVerdicts(path, [a, b], verdicts);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.comment).toBe(a);
    expect(matches[0]?.id).toBe(commentId(path, a));
  });

  test("leaves a comment whose id carries no verdict untouched", () => {
    expect(matchVerdicts(path, [a, b], new Map())).toEqual([]);
  });

  test("treats a changed comment as drift: a new id finds no verdict", () => {
    const verdicts = new Map([[commentId(path, a), verdict()]]);
    const moved = comment({ text: "// a", startLine: 2, endColumn: 4 });
    expect(matchVerdicts(path, [moved], verdicts)).toEqual([]);
  });
});
