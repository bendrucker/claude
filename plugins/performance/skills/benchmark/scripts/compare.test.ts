import { describe, expect, it } from "bun:test";
import {
  compare,
  flagged,
  loadedRounds,
  loadSummary,
  logPath,
  median,
  type Meta,
  permutationP,
  pool,
  progress,
  relativeMad,
  render,
} from "./compare";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function result(name: string | null, times: number[], exitCodes = times.map(() => 0)) {
  return {
    command: `run ${name ?? "unnamed"}`,
    name,
    measurements: times.map((value, i) => ({
      time_wall_clock: { value },
      memory_peak_resident: { value: 50e6 },
      exit_code: exitCodes[i] ?? 0,
    })),
  };
}

function file(...results: ReturnType<typeof result>[]) {
  return { schema_version: 2 as const, results };
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
      file(result("base", [1, 2]), result("cand", [3, 4], [0, 1])),
      file(result("cand", [5]), result("base", [6])),
    ]);
    expect(arms).toEqual([
      { name: "base", times: [1, 2, 6], memory: [50e6, 50e6, 50e6], failures: 0 },
      { name: "cand", times: [3, 5], memory: [50e6, 50e6], failures: 1, failedTimes: [4] },
    ]);
  });

  it("keys an unnamed result by its command", () => {
    const [arm] = pool([file({ ...result(null, [1]), command: "sleep 1" })]);
    expect(arm?.name).toBe("sleep 1");
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

  it("does not star a low-n arm", () => {
    const [, row] = compare(
      [base, { ...base, name: "cand", times: [0.5, 0.5, 0.5] }],
      "base",
      0.1,
      0.03,
      seeded(3),
    );
    expect(row).toMatchObject({ lowN: true, significant: false });
  });

  it("compares peak memory when asked, ignoring wall time", () => {
    const memory = [50e6, 50.5e6, 49.5e6, 50.2e6, 49.8e6, 50e6];
    const leaner = { ...base, name: "leaner", memory: memory.map((m) => m * 0.8) };
    const [, row] = compare([{ ...base, memory }, leaner], "base", 0.1, 0.03, seeded(2), "memory");
    expect(row).toMatchObject({ n: 6, median: 40e6, significant: true });
    expect(row?.change).toBeCloseTo(-0.2);
  });

  it("stars a deterministic difference between constant arms", () => {
    const flat = { ...base, memory: [50e6, 50e6, 50e6, 50e6] };
    const [, row] = compare(
      [flat, { ...flat, name: "leaner", memory: [40e6, 40e6, 40e6, 40e6] }],
      "base",
      0.1,
      0.03,
      seeded(2),
      "memory",
    );
    expect(row).toMatchObject({ p: 0, significant: true });
  });

  it("rejects an unknown base", () => {
    expect(() => compare([base], "missing", 0.1, 0.03)).toThrow("no arm named missing");
  });
});

describe("progress", () => {
  it("prints each arm's median and failures", () => {
    expect(
      progress([
        { name: "base", times: [0.08, 0.1, 0.09], memory: [], failures: 0 },
        { name: "cand", times: [2.5], memory: [], failures: 2, failedTimes: [336, 5.2] },
        { name: "none", times: [], memory: [], failures: 1 },
      ]),
    ).toBe("base 90.0ms, cand 2.50s (2 failed at 336.00s, 5.20s), none - (1 failed)");
  });
});

function makeMeta(loads: [number, number][]): Meta {
  return {
    hypothesis: "memo cuts parse; wall -8%",
    started: "2026-10-16T00:00:00.000Z",
    ncpu: 10,
    arms: [],
    rounds: loads.map(([loadBefore, loadAfter]) => ({ order: [], loadBefore, loadAfter })),
  };
}

describe("flagged", () => {
  it.each<{ name: string; loads: [number, number][]; expected: number[] }>([
    {
      name: "quiet rounds",
      loads: [
        [3, 5],
        [19, 20],
      ],
      expected: [],
    },
    {
      name: "load rising during a round",
      loads: [
        [5, 8],
        [12, 25],
      ],
      expected: [2],
    },
    {
      name: "load falling during a round",
      loads: [
        [52, 18],
        [4, 4],
      ],
      expected: [1],
    },
  ])("$name", ({ loads, expected }) => {
    expect(flagged(makeMeta(loads))).toEqual(expected);
  });
});

describe("loadedRounds", () => {
  it("names the export file of each flagged round", () => {
    const meta = makeMeta([
      [3, 5],
      [52, 61],
      [4, 4],
      [30, 22],
    ]);
    expect(loadedRounds("out", meta)).toEqual(["out/round-001.json", "out/round-003.json"]);
  });
});

describe("loadSummary", () => {
  it.each<{ name: string; loads: [number, number][] }>([
    { name: "quiet", loads: [[3, 5]] },
    {
      name: "loaded",
      loads: [
        [3, 5],
        [52, 61],
        [4, 4],
        [30, 22],
      ],
    },
  ])("$name", ({ loads }) => {
    expect(loadSummary(makeMeta(loads))).toMatchSnapshot();
  });
});

describe("logPath", () => {
  it.each([
    {
      name: "XDG cache home",
      env: { XDG_CACHE_HOME: "/x" },
      expected: "/x/performance/comparisons.jsonl",
    },
    { name: "home cache", env: {}, expected: "/.cache/performance/comparisons.jsonl" },
  ])("$name", ({ env, expected }) => {
    expect(logPath(env)).toEndWith(expected);
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
      significant: false,
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
