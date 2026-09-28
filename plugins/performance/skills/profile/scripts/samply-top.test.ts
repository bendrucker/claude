import { describe, expect, it } from "bun:test";
import { rank, renderJson, renderText, summarize, symbolicator, tally } from "./samply-top";

const thread = {
  processName: "demo",
  pid: "1",
  isMainThread: true,
  processStartupTime: 0,
  processShutdownTime: 10,
  stringArray: ["0x10", "0x20", "0x30"],
  samples: {
    stack: [2, 2, 1, 0],
    time: [1, 2, 3, 4],
    weight: null,
    threadCPUDelta: [1000, 2000, 1000, 0],
  },
  stackTable: { frame: [0, 1, 2], prefix: [null, 0, 1] },
  frameTable: { address: [0x10, 0x20, 0x30], func: [0, 1, 2] },
  funcTable: { name: [0, 1, 2], resource: [0, 0, 0] },
  resourceTable: { lib: [0] },
};

const profile = {
  meta: { interval: 1 },
  libs: [{ debugName: "demo", codeId: "abc" }],
  threads: [thread],
};

const syms = {
  string_table: ["main", "work", "hash"],
  data: [
    {
      code_id: "abc",
      debug_name: "demo",
      symbol_table: [{ symbol: 0 }, { symbol: 1 }, { symbol: 2 }],
      known_addresses: [
        [0x10, 0],
        [0x20, 1],
        [0x30, 2],
      ] satisfies [number, number][],
    },
  ],
};

describe("tally", () => {
  it("weights by CPU and symbolicates through the sidecar", () => {
    const t = tally(profile, [thread], symbolicator(profile, syms), false);
    expect(t.sum).toBe(4);
    expect(Object.fromEntries(t.self)).toEqual({ "hash (demo)": 3, "work (demo)": 1 });
    expect(Object.fromEntries(t.total)).toEqual({
      "main (demo)": 4,
      "work (demo)": 4,
      "hash (demo)": 3,
    });
  });

  it("counts idle samples in wall mode", () => {
    const t = tally(profile, [thread], symbolicator(profile, syms), true);
    expect(t.sum).toBe(4);
    expect(t.self.get("main (demo)")).toBe(1);
  });

  it("falls back to raw addresses without a sidecar", () => {
    const t = tally(profile, [thread], symbolicator(profile, undefined), false);
    expect([...t.self.keys()]).toEqual(["0x30 (demo)", "0x20 (demo)"]);
  });
});

describe("rank", () => {
  const t = tally(profile, [thread], symbolicator(profile, syms), false);

  it.each([
    [10, 100, ["work (demo)", "main (demo)", "hash (demo)"]],
    [1, 100, ["work (demo)"]],
    [3, 5, ["work…", "main…", "hash…"]],
  ])("top %p, truncate %p", (top, truncate, names) => {
    expect(rank(t, "total", top, truncate).map((r) => r.function)).toEqual(names);
  });
});

describe("summary", () => {
  const t = tally(profile, [thread], symbolicator(profile, syms), false);
  const summary = summarize(profile, t, false, 25, 100);

  it("renders tables", () => {
    expect(renderText(summary)).toMatchSnapshot();
  });

  it("renders JSON", () => {
    expect(renderJson(summary)).toMatchSnapshot();
  });

  it("rounds JSON numbers to one decimal", () => {
    const self = [{ function: "f", ms: 1 / 3, percent: 200 / 3 }];
    const json = renderJson({ ...summary, totalMs: 0.5, self, inclusive: [] });
    expect(JSON.parse(json)).toMatchObject({
      totalMs: 0.5,
      self: [{ ms: 0.3, percent: 66.7 }],
    });
  });
});
