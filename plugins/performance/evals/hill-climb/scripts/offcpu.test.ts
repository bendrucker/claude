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
    ["quotesvc", "alloc-first.md", { gap: false, profile: false }, ["json", "sprintf", "alloc"]],
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
  ])("%s", async (_, reply, traps) => {
    expect(scoreOffCpu(reply, await truthOf("kvload")).traps).toEqual(traps);
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
