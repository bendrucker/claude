import { describe, expect, it } from "bun:test";
import { parse, rank, renderJson, renderText, summarize, tally } from "./heap-top";

const report = `
Physical footprint:         12.0M
Physical footprint (peak):  40.0M
----

High water mark of allocated heap + VM memory: 32.0 MB  at malloc stack log record index 1,316
     Current total allocated heap + VM memory: Zero KB  at malloc stack log record index 2,318

Call graph:
    1002 (32.0M) << TOTAL >>
      1002 (32.0M) start  (in dyld) + 6992  [0x18709ab98]
        1002 (32.0M) main  (in demo) + 40  [0x102ae04a8]  demo.c:9
        + 1 (24.0M) load  (in demo) + 20  [0x102ae0424]  demo.c:3
        + ! 1 (24.0M) Arena::grow(unsigned long)  (in demo) + 12  [0x102ae0500]
        + !   1 (24.0M) _malloc_zone_malloc_instrumented_or_legacy  (in libsystem_malloc.dylib) + 288  [0x1870014b4]
        + 1000 (8.0M) parse  (in demo) + 20  [0x102ae044c]  demo.c:4
        + ! 1000 (8.0M) operator new(unsigned long)  (in libc++abi.dylib) + 52  [0x18729d3c8]
        + 1 (200 bytes) parse  (in demo) + 24  [0x102ae0450]  demo.c:4

Total number in stack -- this line is here to get the correct format for importing with the Sampler instrument in Instruments.app
`;

const MB = 1024 ** 2;

describe("parse", () => {
  const parsed = parse(report);

  it("reads the high-water mark and peak footprint in binary units", () => {
    expect(parsed.highWater).toBe(32 * MB);
    expect(parsed.footprintPeak).toBe(40 * MB);
  });

  it("nests frames by indentation and splits off the library", () => {
    const main = parsed.roots[0]?.children[0]?.children[0];
    expect(main).toMatchObject({ name: "main", lib: "demo", bytes: 32 * MB });
    expect(main?.children.map((c) => c.name)).toEqual(["load", "parse", "parse"]);
    expect(main?.children[2]?.bytes).toBe(200);
  });
});

describe("tally", () => {
  const parsed = parse(report);

  it("attributes bytes to the deepest frame outside the allocator", () => {
    const t = tally(parsed);
    expect(Object.fromEntries(t.sites)).toEqual({
      "Arena::grow(unsigned long) (demo)": 24 * MB,
      "parse (demo)": 8 * MB + 200,
    });
  });

  it("moves a wrapper's bytes to its caller with skip", () => {
    const t = tally(parsed, /^Arena::/);
    expect(t.sites.get("load (demo)")).toBe(24 * MB);
  });

  it("leaves allocator frames out of the inclusive ranking", () => {
    const t = tally(parsed);
    expect([...t.inclusive.keys()]).not.toContain(
      "_malloc_zone_malloc_instrumented_or_legacy (libsystem_malloc.dylib)",
    );
    expect(t.inclusive.get("main (demo)")).toBe(t.sum);
  });

  it("drops a remainder within the children's rounding", () => {
    const rounded = parse(`
    3 (10.0M) main  (in demo) + 40  [0x1]
    + 1 (3.3M) a  (in demo) + 4  [0x2]
    + 1 (3.3M) b  (in demo) + 4  [0x3]
    + 1 (3.3M) c  (in demo) + 4  [0x4]
`);
    expect([...tally(rounded).sites.keys()]).toEqual(["a (demo)", "b (demo)", "c (demo)"]);
  });

  it("sums the bytes under matching frames", () => {
    expect(tally(parsed, undefined, /load/).matched).toBe(24 * MB);
  });
});

describe("summary", () => {
  const parsed = parse(report);
  const match = /parse/;
  const summary = summarize(parsed, tally(parsed, undefined, match), 25, 100, match);

  it("reports coverage against the peak footprint", () => {
    expect(summary.coveragePercent).toBe(80);
  });

  it("truncates names", () => {
    expect(rank(tally(parsed), "sites", 1, 6).map((r) => r.function)).toEqual(["Arena…"]);
  });

  it("renders tables", () => {
    expect(renderText(summary)).toMatchSnapshot();
  });

  it("renders JSON", () => {
    expect(renderJson(summary)).toMatchSnapshot();
  });
});
