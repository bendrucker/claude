import { describe, expect, it } from "bun:test";
import { compare, median, permutationP, pool, relativeMad, render } from "./compare";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function result(command: string, times: number[], exitCodes = times.map(() => 0)) {
  return { command, times, exit_codes: exitCodes, memory_usage_byte: times.map(() => 50e6) };
}

describe("median", () => {
  it.each([
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
    [[], Number.NaN],
  ])("%p -> %p", (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});

describe("relativeMad", () => {
  it("ignores a single outlier", () => {
    expect(relativeMad([1, 1, 1, 1, 100])).toBe(0);
  });
});

describe("permutationP", () => {
  it("is large for identical samples", () => {
    const a = [1, 1.1, 0.9, 1.05, 0.95, 1];
    expect(permutationP(a, [...a], 2000, seeded(1))).toBeGreaterThan(0.5);
  });

  it("is small for separated samples", () => {
    const a = [1, 1.01, 0.99, 1.02, 0.98, 1, 1.01, 0.99];
    const b = a.map((v) => v * 0.8);
    expect(permutationP(a, b, 2000, seeded(1))).toBeLessThan(0.01);
  });
});

describe("pool", () => {
  it("merges rounds per arm and drops failed runs", () => {
    const arms = pool([
      { results: [result("base", [1, 2]), result("cand", [3, 4], [0, 1])] },
      { results: [result("cand", [5]), result("base", [6])] },
    ]);
    expect(arms).toEqual([
      { name: "base", times: [1, 2, 6], memory: [50e6, 50e6, 50e6], failures: 0 },
      { name: "cand", times: [3, 5], memory: [50e6, 50e6, 50e6], failures: 1 },
    ]);
  });
});

describe("compare", () => {
  const base = { name: "base", times: [1, 1.01, 0.99, 1.02, 0.98, 1], memory: [], failures: 0 };

  it("stars a large, significant change", () => {
    const fast = { ...base, name: "fast", times: base.times.map((t) => t * 0.7) };
    const [, row] = compare([base, fast], "base", 0.1, 0.03, seeded(2));
    expect(row?.significant).toBe(true);
    expect(row?.change).toBeCloseTo(-0.3);
  });

  it("leaves a change below the minimum effect unstarred", () => {
    const close = { ...base, name: "close", times: base.times.map((t) => t * 0.99) };
    const [, row] = compare([base, close], "base", 0.1, 0.03, seeded(2));
    expect(row?.significant).toBe(false);
  });

  it("flags low sample counts", () => {
    const [row] = compare([{ ...base, times: [1, 1, 1] }], "base", 0.1, 0.03);
    expect(row?.lowN).toBe(true);
  });

  it("rejects an unknown base", () => {
    expect(() => compare([base], "missing", 0.1, 0.03)).toThrow("no arm named missing");
  });
});

describe("render", () => {
  const rows = [
    {
      arm: "base",
      n: 12,
      median: 0.5,
      spread: 0.02,
      significant: false,
      lowN: false,
      failures: 0,
      memory: 50e6,
    },
    {
      arm: "cand",
      n: 3,
      median: 1.2,
      spread: 0.05,
      change: -0.25,
      p: 0.012,
      significant: true,
      lowN: true,
      failures: 2,
    },
  ];

  it("renders markdown", () => {
    expect(render(rows, true)).toMatchSnapshot();
  });

  it("renders a terminal table", () => {
    expect(render(rows, false)).toMatchSnapshot();
  });
});
