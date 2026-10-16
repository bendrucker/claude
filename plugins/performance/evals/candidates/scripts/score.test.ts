import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Block,
  cites,
  listBlocks,
  profileRefs,
  render,
  type ScoredRun,
  scoreReply,
  scoreResults,
  Truth,
} from "./score";

const suite = join(import.meta.dir, "..");
const truth = Truth.parse(await Bun.file(join(suite, "logship", "truth.json")).json());
const profile = await Bun.file(join(suite, "logship", truth.profile)).text();
const example = (name: string) => Bun.file(join(suite, "examples", "logship", name)).text();
const pass = await example("pass.md");
const trapFirst = await example("trap-first.md");

describe("listBlocks", () => {
  test.each<[string, string, Block[]]>([
    [
      "continuation lines and sub-bullets",
      "1. first\n   - detail\n2. second\nlazy line\n\nAfter.",
      [{ kind: "numbered", entries: ["first\n- detail", "second\nlazy line"] }],
    ],
    [
      "restarted numbering",
      "1. a\n2. b\n\n1. c",
      [
        { kind: "numbered", entries: ["a", "b"] },
        { kind: "numbered", entries: ["c"] },
      ],
    ],
    [
      "a ranked table",
      "| # | Candidate | Share |\n| --- | --- | ---: |\n| 1 | dedupe | 43.9% |\n| **2** | regex | 24% |",
      [{ kind: "table", entries: ["dedupe | 43.9%", "regex | 24%"] }],
    ],
    ["an unranked table", "| Entry | cum |\n| --- | --- |\n| main.dedupe | 1.80s |", []],
    [
      "bullets beside a numbered list",
      "1. a\n\n## Set aside\n\n- b\n- c",
      [
        { kind: "numbered", entries: ["a"] },
        { kind: "bullet", entries: ["b", "c"] },
      ],
    ],
  ])("%s", (_, reply, blocks) => {
    expect(listBlocks(reply)).toEqual(blocks);
  });
});

describe("cites", () => {
  const refs = profileRefs(profile);
  test.each([
    ["`main.dedupe`", true],
    ["the dedupe loop", true],
    ["`main.(*Stats).Inc`", true],
    ["Stats.Inc", true],
    ["regexp.MustCompile", true],
    ["about 43.9% of samples", true],
    ["24.15%", true],
    ["take the lock less", false],
    ["Buffer stdout in larger chunks", false],
    ["4.16 s wall", false],
  ])("%s → %p", (entry, expected) => {
    expect(cites(entry, refs)).toBe(expected);
  });
});

describe("scoreReply", () => {
  const regexShare = 0.2415 / (0.439 + 0.2415);
  test.each([
    {
      name: "the pass example",
      reply: pass,
      recall: 1,
      traps: [],
      cited: 1,
      parallelism: true,
    },
    {
      name: "the trap-first example",
      reply: trapFirst,
      recall: regexShare,
      traps: ["fanout-parallel", "stats-mutex"],
      cited: 0.5,
      parallelism: true,
    },
    {
      name: "a win that dismisses a trap in passing",
      reply:
        "1. Map in `dedupe`, not the mutex.\n2. Hoist `regexp.MustCompile`.\n3. Mutex in `Stats.Inc`.",
      recall: 1,
      traps: [],
      cited: 1,
      parallelism: false,
    },
    {
      name: "a win ranked past five",
      reply: "1. `fanOut`\n2. a\n3. b\n4. c\n5. d\n6. `dedupe`\n7. `regexp.MustCompile`",
      recall: 0,
      traps: ["fanout-parallel"],
      cited: 3 / 7,
      parallelism: false,
    },
    {
      name: "a ranked table",
      reply: "| Rank | Candidate |\n| --- | --- |\n| 1 | dedupe map |\n| 2 | MustCompile hoist |",
      recall: 1,
      traps: [],
      cited: 1,
      parallelism: false,
    },
    {
      name: "no list",
      reply: "Profile first.",
      recall: 0,
      traps: [],
      cited: 0,
      parallelism: false,
    },
  ])("$name", ({ reply, recall, traps, cited, parallelism }) => {
    const score = scoreReply(reply, truth, profile);
    expect(score.recall).toBeCloseTo(recall);
    expect(score.traps.toSorted()).toEqual(traps);
    expect(score.cited).toBeCloseTo(cited);
    expect(score.parallelism).toBe(parallelism);
    expect(score.composite).toBeCloseTo(recall - 0.5 * traps.length);
  });
});

test("scoreResults reads each trace's final reply", async () => {
  const results = mkdtempSync(join(tmpdir(), "candidates-"));
  const trace = (result: string) =>
    [{ type: "assistant" }, { type: "result", result }].map((l) => JSON.stringify(l)).join("\n");
  await Bun.write(join(results, "traces", "logship-with-0.jsonl"), trace(pass));
  await Bun.write(join(results, "traces", "logship-without-0.jsonl"), trace("1. `fanOut`"));
  const runs = await scoreResults(suite, results);
  expect(runs.map((r) => [r.arm, r.composite])).toEqual([
    ["with", 1],
    ["without", -0.5],
  ]);
});

test("render", () => {
  const run = (arm: string, n: number, composite: number): ScoredRun => ({
    case: "logship",
    arm,
    run: n,
    recall: Math.max(composite, 0),
    traps: composite < 0 ? ["stats-mutex"] : [],
    cited: 1,
    parallelism: true,
    composite,
    ranks: {},
    size: 4,
  });
  expect(render([run("with", 0, 1), run("with", 1, 1), run("without", 0, -0.5)])).toMatchSnapshot();
});
