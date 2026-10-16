import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { OffCpuTruth, rankedList, scoreOffCpu } from "./offcpu";

const suite = join(import.meta.dir, "..");
const truthOf = async (name: string) =>
  OffCpuTruth.parse(await Bun.file(join(suite, name, "truth.json")).json());
const example = async (name: string, file: string) =>
  (await Bun.file(join(suite, "examples", name, file)).text()).replace(/^---\n[\s\S]*?\n---\n/, "");

test("rankedList takes the last numbered list", () => {
  expect(rankedList("1. a\n2. b\n\nThen:\n\n- x\n\n1. c\n2. d")).toEqual(["c", "d"]);
});

describe("scoreOffCpu", () => {
  test.each<[string, string, Record<string, boolean>, string[]]>([
    ["kvload", "pass.md", { gap: true, profile: true }, []],
    ["kvload", "cpu-first.md", { gap: false, profile: false }, ["json", "crc"]],
    ["quotesvc", "pass.md", { gap: true, profile: true }, []],
    ["quotesvc", "alloc-first.md", { gap: false, profile: false }, ["json", "sprintf"]],
    ["sitegen", "pass.md", { gap: true, profile: true }, []],
    ["sitegen", "warm-first.md", { gap: false, profile: false }, ["template", "minify"]],
  ])("%s %s", async (name, file, checks, traps) => {
    const score = scoreOffCpu(await example(name, file), await truthOf(name));
    expect(score.checks).toEqual(checks);
    expect(score.traps).toEqual(traps);
  });

  test.each([
    [
      "an entry naming the lead does not count as a trap",
      "1. Batch the fsync calls, then revisit json encoding.\n2. Time each fsync.",
      [],
    ],
    ["a trap at rank three is fine", "1. Batch fsync.\n2. Measure off-CPU.\n3. crc32 table.", []],
    ["a trap at rank two counts", "1. Batch fsync.\n2. Faster crc32.", ["crc"]],
    [
      "parallel CPU work after the fsync fix, naming three entries",
      "1. **Drop the per-record fsync and sync once at the end.**\n2. **Run decode, normalize, marshal and CRC in parallel, with an ordered writer.**\n   - It targets the 2.05 s of CPU work.",
      [],
    ],
    [
      "one trap per candidate",
      "1. **Hand-write the JSON encoder.** Also drops the crc32 copy.\n2. Batch fsync.",
      ["json"],
    ],
    [
      "a lead in the detail leaves a micro-opt headline a trap",
      "1. Batch fsync.\n2. **Cut JSON re-encoding in `Put`.** Flush before the final sync.",
      ["json"],
    ],
  ])("%s", async (_, reply, traps) => {
    expect(scoreOffCpu(reply, await truthOf("kvload")).traps).toEqual(traps);
  });

  test.each<[string, string, string, number]>([
    ["kvload", "fsync first", "1. **Batch the WAL `fsync`.**\n2. Faster crc32.", 1],
    [
      "kvload",
      "a profiling step before the lead",
      "1. Measure off-CPU time with `strace -c`.\n2. Sync once at the end.",
      1,
    ],
    ["kvload", "absent", "1. Hand-write the encoder.\n2. Faster crc32.", 3],
    [
      "quotesvc",
      "lock second",
      "1. Pool the JSON buffers.\n2. **Fetch outside the write lock in `Cache.refresh`.**",
      2,
    ],
    [
      "sitegen",
      "writeImage hashing is not the lead",
      "1. **Hash and write each image once.**\n2. **Resize images in parallel.**",
      2,
    ],
    [
      "sitegen",
      "a parallel image pool citing cold resizing",
      "1. **Render pages in parallel.**\n2. **Run `writeImage` in a worker pool.** Cold resizing dominates wall time.",
      2,
    ],
    [
      "sitegen",
      "a parallel image pool citing warm hashing",
      "1. **Run `writeImage` in a worker pool.** It is 21.6%, mostly sha256.\n2. **Resize images in parallel.**",
      2,
    ],
    [
      "sitegen",
      "remote includes ranked last by rule",
      "1. Render pages in parallel.\n2. Cache parsed templates.\n3. **Prefetch remote includes.** No profile entry behind it, so it ranks last.",
      3,
    ],
  ])("leadRank %s: %s", async (name, _, reply, rank) => {
    expect(scoreOffCpu(reply, await truthOf(name)).leadRank).toBe(rank);
  });

  test.each([
    [
      "parallel rendering, which overlaps the cold fetches",
      "1. Render pages in parallel. Shared `navLinks` state needs a lock.\n2. Fetch includes concurrently.",
      [],
    ],
    ["a warm template micro-opt", "1. Re-profile cold.\n2. Cache parsed templates.", ["template"]],
  ])("sitegen: %s", async (_, reply, traps) => {
    expect(scoreOffCpu(reply, await truthOf("sitegen")).traps).toEqual(traps);
  });
});
