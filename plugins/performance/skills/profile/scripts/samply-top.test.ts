import { describe, expect, it } from "bun:test";
import { symbolicator, tally } from "./samply-top";

// Stacks: 0 = main, 1 = main > work, 2 = main > work > hash.
// Samples: two in hash (3ms CPU), one in work (1ms), one idle in main (0ms).
const thread = {
  processName: "demo",
  pid: "1",
  isMainThread: true,
  name: "main",
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
