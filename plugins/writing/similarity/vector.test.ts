import { describe, expect, test } from "bun:test";
import {
  centroid,
  euclidean,
  fitScaler,
  margin,
  mean,
  median,
  quantileOfSorted,
  ruzicka,
  spread,
  standardDeviation,
  standardize,
} from "./vector";

describe("summary statistics", () => {
  test.each([
    ["mean", () => mean([1, 2, 3]), 2],
    ["mean of empty", () => mean([]), 0],
    ["median odd", () => median([3, 1, 2]), 2],
    ["median even", () => median([4, 1, 2, 3]), 2.5],
    ["sd", () => standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395],
    ["sd of single value", () => standardDeviation([5]), 0],
    ["quantile min", () => quantileOfSorted([0, 5, 10], 0), 0],
    ["quantile mid", () => quantileOfSorted([0, 5, 10], 0.5), 5],
    ["quantile interpolates", () => quantileOfSorted([0, 10], 0.25), 2.5],
    ["quantile of empty", () => quantileOfSorted([], 0.5), 0],
  ])("%s", (_name, compute, expected) => {
    expect(compute()).toBeCloseTo(expected, 10);
  });
});

test("fitScaler centers and scales each column", () => {
  const scaler = fitScaler([
    [0, 10],
    [2, 20],
    [4, 30],
  ]);
  expect(scaler.mean).toEqual([2, 20]);
  expect(standardize([2, 20], scaler)).toEqual([0, 0]);
  expect(standardize([4, 20], scaler)[0]).toBeCloseTo(1, 10);
});

test("fitScaler leaves a constant column at unit scale", () => {
  const scaler = fitScaler([
    [7, 1],
    [7, 2],
  ]);
  expect(scaler.sd[0]).toBe(1);
  expect(standardize([9, 1.5], scaler)[0]).toBe(2);
});

test("centroid and spread summarize a population", () => {
  const rows = [
    [0, 1],
    [2, 1],
    [4, 1],
  ];
  expect(centroid(rows)).toEqual([2, 1]);
  expect(spread(rows)[0]).toBeCloseTo(2, 10);
  expect(spread(rows)[1]).toBe(1);
});

describe("distances", () => {
  test.each([
    ["euclidean", () => euclidean([0, 0], [3, 4]), 5],
    ["euclidean to self", () => euclidean([1, 2, 3], [1, 2, 3]), 0],
    ["ruzicka identical", () => ruzicka([0.5, 0.5], [0.5, 0.5]), 0],
    ["ruzicka disjoint", () => ruzicka([1, 0], [0, 1]), 1],
    ["ruzicka partial", () => ruzicka([0.6, 0.4], [0.4, 0.6]), 1 / 3],
    ["ruzicka of empty vectors", () => ruzicka([0, 0], [0, 0]), 1],
  ])("%s", (_name, compute, expected) => {
    expect(compute()).toBeCloseTo(expected, 10);
  });
});

describe("margin", () => {
  test.each([
    ["nearer the voice pole", 1, 3, 1],
    ["nearer the contrast pole", 3, 1, -1],
    ["equidistant", 2, 2, 0],
    ["both zero", 0, 0, 0],
  ])("%s", (_name, voice, contrast, expected) => {
    expect(margin(voice, contrast)).toBeCloseTo(expected, 10);
  });
});
