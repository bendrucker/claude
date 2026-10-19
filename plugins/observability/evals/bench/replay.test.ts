import { expect, test } from "bun:test";
import { type Sample, summarize } from "./replay";

const sample = (arm: string, wall: number, run: number): Sample => ({
  query: "q",
  limits: "vm",
  arm,
  base: arm === "base",
  run,
  wall,
  exit: 0,
  oom: false,
  timeout: false,
});

test("summarize puts the base first and stars only a change past the noise floor", () => {
  const walls = [1, 1.02, 0.98, 1.01, 0.99, 1];
  const samples = [
    ...walls.map((w, i) => sample("small", w * 1.05, i)),
    ...walls.map((w, i) => sample("base", w, i)),
    ...walls.map((w, i) => sample("big", w * 0.5, i)),
  ];
  const rows = summarize(samples, (s) => s.query);
  expect(rows.map((r) => r.arm)).toEqual(["base", "small", "big"]);
  expect(rows.map((r) => r.significant)).toEqual([false, false, true]);
  expect(rows[0]?.floor).toBeCloseTo(0.1);
});
