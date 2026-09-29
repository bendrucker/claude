import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Pick } from "./pairs";
import { pickByDistance, settleEdits, wordDistance } from "./redline";

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

describe("settleEdits", () => {
  test.each<{ name: string; replies: string[]; maxPasses: number; passes: number }>([
    {
      name: "stops at the first unchanged pass",
      replies: ["b c", "b c", "x"],
      maxPasses: 4,
      passes: 2,
    },
    { name: "stops at the pass cap", replies: ["b", "c d", "e f g"], maxPasses: 2, passes: 2 },
  ])("$name", async ({ replies, maxPasses, passes }) => {
    const queue = [...replies];
    const result = await settleEdits(
      "a b c",
      (text) => text,
      () => Promise.resolve(queue.shift() ?? ""),
      maxPasses,
      0.02,
    );
    expect(result).toEqual(replies.slice(0, passes));
  });
});

test.each<[number, number, number, Pick]>([
  [0.1, 0.4, 0, "a"],
  [0.4, 0.1, 0, "b"],
  [0.2, 0.25, 0.1, "tie"],
])("pickByDistance(%d, %d, margin %d) is %s", (a, b, margin, pick) => {
  expect(pickByDistance(a, b, margin)).toBe(pick);
});
