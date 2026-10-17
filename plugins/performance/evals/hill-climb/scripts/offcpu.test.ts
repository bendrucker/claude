import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { leadRank, OffCpuTruth, rankedList } from "./offcpu";

const suite = join(import.meta.dir, "..");
const truthOf = async (name: string) =>
  OffCpuTruth.parse(await Bun.file(join(suite, name, "truth.json")).json());
const example = async (name: string, file: string) =>
  (await Bun.file(join(suite, "examples", name, file)).text()).replace(/^---\n[\s\S]*?\n---\n/, "");

test("rankedList takes the last numbered list", () => {
  expect(rankedList("1. a\n2. b\n\nThen:\n\n- x\n\n1. c\n2. d")).toEqual(["c", "d"]);
});

describe("leadRank on the examples", () => {
  test.each([
    ["kvload", "pass.md", 1],
    ["quotesvc", "pass.md", 1],
    ["sitegen", "pass.md", 1],
  ])("%s %s", async (name, file, rank) => {
    expect(leadRank(await example(name, file), await truthOf(name))).toBe(rank);
  });
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
  expect(leadRank(reply, await truthOf(name))).toBe(rank);
});
