import { describe, expect, test } from "bun:test";
import { calibrate, LADDER_SIZE, percentileOf } from "./calibration";

const uniform = calibrate(Array.from({ length: 1000 }, (_, i) => i / 999));

test("calibrate stores one rung per whole percentile", () => {
  expect(uniform.ladder).toHaveLength(LADDER_SIZE);
  expect(uniform.sampleSize).toBe(1000);
  expect(uniform.ladder.toSorted((a, b) => a - b)).toEqual(uniform.ladder);
});

describe("percentileOf", () => {
  test.each([
    ["below the sample", -1, 0],
    ["at the floor", 0, 0],
    ["median", 0.5, 50],
    ["upper quartile", 0.75, 75],
    ["at the ceiling", 1, 100],
    ["above the sample", 2, 100],
  ])("%s", (_name, score, expected) => {
    expect(percentileOf(uniform, score)).toBeCloseTo(expected, 1);
  });
});

test("percentileOf interpolates between rungs", () => {
  const low = percentileOf(uniform, 0.503);
  const high = percentileOf(uniform, 0.507);
  expect(high).toBeGreaterThan(low);
});

test("a constant sample collapses to a flat ladder", () => {
  const flat = calibrate([2, 2, 2]);
  expect(new Set(flat.ladder)).toEqual(new Set([2]));
  expect(percentileOf(flat, 2)).toBe(0);
  expect(percentileOf(flat, 3)).toBe(100);
});
