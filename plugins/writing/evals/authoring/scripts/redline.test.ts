import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Pick } from "./pairs";
import { applyEdits, type Edit, pickByDistance, settleEdits, wordDistance } from "./redline";

describe("wordDistance", () => {
  test.each<{ name: string; from: string; to: string; deleted: number; inserted: number }>([
    { name: "identical", from: "Adds a flag.", to: "Adds a flag.", deleted: 0, inserted: 0 },
    {
      name: "case and punctuation",
      from: "Adds a flag.",
      to: "adds a flag",
      deleted: 0,
      inserted: 0,
    },
    {
      name: "cut",
      from: "This change adds a new flag.",
      to: "Adds a flag.",
      deleted: 3,
      inserted: 0,
    },
    {
      name: "rewrite",
      from: "It serves as a cache.",
      to: "It is a cache.",
      deleted: 2,
      inserted: 1,
    },
  ])("$name", ({ from, to, deleted, inserted }) => {
    expect(wordDistance(from, to)).toMatchObject({ deleted, inserted });
  });

  test("a draft is zero from itself and the words kept agree in both directions", () => {
    hegel.test((tc) => {
      const word = gs.sampledFrom(["add", "flag", "the", "cache", "it", "a"]);
      const a = tc.draw(gs.arrays(word, { maxSize: 30 })).join(" ");
      const b = tc.draw(gs.arrays(word, { maxSize: 30 })).join(" ");
      expect(wordDistance(a, a).distance).toBe(0);
      const there = wordDistance(a, b);
      const back = wordDistance(b, a);
      expect([back.deleted, back.inserted]).toEqual([there.inserted, there.deleted]);
    });
  });
});

describe("applyEdits", () => {
  test.each<{ name: string; edits: Edit[]; text: string; applied: number }>([
    {
      name: "replace",
      edits: [{ find: "serves as", replace: "is" }],
      text: "It is a cache.",
      applied: 1,
    },
    {
      name: "delete",
      edits: [{ find: " a cache", replace: " cache" }],
      text: "It serves as cache.",
      applied: 1,
    },
    {
      name: "missing find",
      edits: [{ find: "absent", replace: "x" }],
      text: "It serves as a cache.",
      applied: 0,
    },
    {
      name: "ambiguous find",
      edits: [{ find: "a", replace: "x" }],
      text: "It serves as a cache.",
      applied: 0,
    },
    {
      name: "empty find",
      edits: [{ find: "", replace: "x" }],
      text: "It serves as a cache.",
      applied: 0,
    },
    {
      name: "later edit sees earlier one",
      edits: [
        { find: "serves as", replace: "is" },
        { find: "is a", replace: "caches" },
      ],
      text: "It caches cache.",
      applied: 2,
    },
  ])("$name", ({ edits, text, applied }) => {
    expect(applyEdits("It serves as a cache.", edits)).toEqual({ text, applied });
  });
});

describe("settleEdits", () => {
  test.each<{
    name: string;
    replies: Edit[][];
    maxPasses: number;
    passes: string[];
    exhausted: boolean;
  }>([
    {
      name: "stops once a pass leaves the text unchanged",
      replies: [[{ find: "b", replace: "x" }], [], [{ find: "x", replace: "y" }]],
      maxPasses: 4,
      passes: ["a x c"],
      exhausted: true,
    },
    {
      name: "keeps every pass when it hits the cap",
      replies: [[{ find: "b", replace: "x" }], [{ find: "x", replace: "y" }], []],
      maxPasses: 2,
      passes: ["a x c", "a y c"],
      exhausted: false,
    },
  ])("$name", async ({ replies, maxPasses, passes, exhausted }) => {
    const queue = [...replies];
    const result = await settleEdits(
      "a b c",
      (text) => text,
      () => Promise.resolve(queue.shift() ?? []),
      maxPasses,
    );
    expect(result).toEqual({ passes, exhausted });
  });
});

test.each<[number, number, number, Pick]>([
  [0.1, 0.4, 0, "a"],
  [0.4, 0.1, 0, "b"],
  [0.2, 0.25, 0.1, "tie"],
])("pickByDistance(%d, %d, margin %d) is %s", (a, b, margin, pick) => {
  expect(pickByDistance(a, b, margin)).toBe(pick);
});
