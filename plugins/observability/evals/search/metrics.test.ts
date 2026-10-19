import { expect, test } from "bun:test";
import { pairedP, score } from "./metrics";

test.each([
  ["a hit at rank 1", ["a", "x", "y"], ["a"], { p5: 0.2, recall10: 1, rr: 1 }],
  ["a hit at rank 3", ["x", "y", "a"], ["a"], { p5: 0.2, recall10: 1, rr: 1 / 3 }],
  ["a hit past 5", ["1", "2", "3", "4", "5", "a"], ["a", "b"], { p5: 0, recall10: 0.5, rr: 1 / 6 }],
  ["no hit", [], ["a"], { p5: 0, recall10: 0, rr: 0 }],
] as const)("%s", (_, ranked, relevant, expected) => {
  expect(score([...ranked], [...relevant])).toEqual(expected);
});

test("pairedP separates a consistent gain from none", () => {
  const base = Array.from({ length: 20 }, () => 0);
  expect(
    pairedP(
      base.map(() => 1),
      base,
    ),
  ).toBeLessThan(0.01);
  expect(pairedP(base, base)).toBe(1);
});
