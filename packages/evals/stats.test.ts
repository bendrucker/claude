import { describe, expect, test } from "bun:test";
import seedrandom from "seedrandom";
import { pFloor, pValue, signFlipPValue, wilson } from "./stats";

describe("pValue", () => {
  test.each<{ name: string; base: number[]; other: number[]; expected: number }>([
    { name: "identical constant samples", base: [1, 1, 1], other: [1, 1], expected: 1 },
    { name: "an empty side", base: [], other: [1], expected: NaN },
  ])("returns $expected for $name", ({ base, other, expected }) => {
    expect(pValue(base, other)).toBe(expected);
  });

  test("separates six passes from six failures", () => {
    expect(pValue([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0])).toBeLessThan(0.1);
  });

  test("does not separate one flip in three", () => {
    expect(pValue([1, 1, 1], [1, 1, 0])).toBeGreaterThan(0.1);
  });
});

describe("pFloor", () => {
  test.each<{ n1: number; n2: number; floor: number }>([
    { n1: 2, n2: 2, floor: 1 / 3 },
    { n1: 3, n2: 3, floor: 0.1 },
    { n1: 4, n2: 4, floor: 2 / 70 },
    { n1: 2, n2: 4, floor: 1 / 15 },
  ])("is $floor for $n1 against $n2", ({ n1, n2, floor }) => {
    expect(pFloor(n1, n2)).toBeCloseTo(floor);
  });
});

describe("signFlipPValue", () => {
  test("returns NaN when every pair tied", () => {
    expect(signFlipPValue([0.5, 0.5, 0.5])).toBeNaN();
  });

  test("a unanimous win for b is extreme", () => {
    const rng = seedrandom("test-a");
    expect(signFlipPValue([1, 1, 1, 1, 1, 1, 1, 1], 2000, rng)).toBeLessThan(0.05);
  });

  test("an even split is not extreme", () => {
    const rng = seedrandom("test-b");
    expect(signFlipPValue([1, 0, 1, 0, 1, 0], 2000, rng)).toBeGreaterThan(0.5);
  });

  test("is deterministic under a seeded rng", () => {
    const wins = [1, 1, 0, 1, 0.5, 1, 0];
    const a = signFlipPValue(wins, 500, seedrandom("same-seed"));
    const b = signFlipPValue(wins, 500, seedrandom("same-seed"));
    expect(a).toBe(b);
  });
});

describe("wilson", () => {
  test.each<{ hits: number; total: number; expected?: number[] }>([
    { hits: 0, total: 0, expected: [0, 1] },
    { hits: 10, total: 10 },
    { hits: 0, total: 10 },
  ])("wilson($hits, $total) stays within [0, 1]", ({ hits, total, expected }) => {
    const [lo, hi] = wilson(hits, total);
    if (expected) expect([lo, hi]).toEqual(expected);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeLessThanOrEqual(hi);
  });

  test("a wider sample at the same rate narrows the interval", () => {
    const [lo1, hi1] = wilson(7, 10);
    const [lo2, hi2] = wilson(70, 100);
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1);
  });

  test("keeps a perfect score's lower bound below 1", () => {
    const [low, high] = wilson(5, 5);
    expect(low).toBeLessThan(1);
    expect(high).toBe(1);
  });
});
