import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Block, cites, listBlocks, profileRefs, scoreReply, Truth } from "./ranking";
import { render, type ScoredRun, scoreResults } from "./score";

const suite = join(import.meta.dir, "..");

async function load(name: string) {
  const truth = Truth.parse(await Bun.file(join(suite, name, "truth.json")).json());
  const profile = await Bun.file(join(suite, name, truth.profile)).text();
  return { truth, profile };
}
const cases = { logship: await load("logship"), ledgerroll: await load("ledgerroll") };
const { profile } = cases.logship;
const example = (name: string, file: string) =>
  Bun.file(join(suite, "examples", name, file)).text();
const pass = await example("logship", "pass.md");
const trapFirst = await example("logship", "trap-first.md");
const ledgerPass = await example("ledgerroll", "pass.md");
const byShare = await example("ledgerroll", "by-share.md");
const paragraphParallel = await example("ledgerroll", "paragraph-parallel.md");

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
    ["24.2%", true],
    ["44% of samples", true],
    ["43.90 % cum", true],
    ["45% of samples", false],
    ["take the lock less", false],
    ["Buffer stdout in larger chunks", false],
    ["4.16 s wall", false],
    ["cut the 1.80 s", true],
    ["0.99s spent compiling", true],
    ["about 1.8 s", true],
    ["about 1.7 s", true],
    ["about 2 s", false],
  ])("%s → %p", (entry, expected) => {
    expect(cites(entry, refs)).toBe(expected);
  });
});

describe("scoreReply", () => {
  const regexShare = 0.2415 / (0.439 + 0.2415);
  const ledgerWins = 0.11 + 0.1 + 0.08 + 0.06;
  test.each<{
    name: string;
    case?: keyof typeof cases;
    reply: string;
    recall: number;
    traps: string[];
    cited: number;
    parallelism: boolean;
  }>([
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
      name: "a regex hoist named verb first",
      reply:
        "1. Hoist the two regexes to package-level `var`s.\n2. Replace the O(n²) scan in `dedupe`.",
      recall: 1,
      traps: [],
      cited: 0.5,
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
    {
      name: "the ledgerroll pass example",
      case: "ledgerroll",
      reply: ledgerPass,
      recall: 1,
      traps: [],
      cited: 1,
      parallelism: true,
    },
    {
      name: "the ledgerroll raw-share example",
      case: "ledgerroll",
      reply: byShare,
      recall: (0.1 + 0.08 + 0.06) / ledgerWins,
      traps: ["gzip"],
      cited: 1,
      parallelism: false,
    },
    {
      name: "parallelism set aside outside the list",
      case: "ledgerroll",
      reply: paragraphParallel,
      recall: 1,
      traps: [],
      cited: 1,
      parallelism: false,
    },
    {
      name: "a ledgerroll win that names gzip in passing",
      case: "ledgerroll",
      reply:
        "1. Typed struct in `decodeRecord`, since gzip is fixed.\n2. `sort.Slice` once per group.",
      recall: 0.21 / ledgerWins,
      traps: [],
      cited: 1,
      parallelism: false,
    },
    {
      name: "a resort described without naming sort.Slice",
      case: "ledgerroll",
      reply: "1. Sort each group once after grouping, instead of after every append (0.60 s).",
      recall: 0.1 / ledgerWins,
      traps: [],
      cited: 1,
      parallelism: false,
    },
    {
      name: "shares cited as rounded percentages",
      case: "ledgerroll",
      reply:
        "1. Fix the aggregate sort (`sort.Slice`, 10% of CPU).\n2. Replace `fmt.Sprintf` in render and `groupKey` (14% of CPU).\n3. Reuse the JSON decoder and struct in `decodeRecord` (17% cumulative).\n4. Reduce allocations to cut GC (8% of CPU).",
      recall: 1,
      traps: [],
      cited: 1,
      parallelism: false,
    },
    {
      name: "a ledgerroll win ranked sixth",
      case: "ledgerroll",
      reply: "1. gzip\n2. GC\n3. `decodeRecord`\n4. `sort.Slice`\n5. `renderRow`\n6. `groupKey`",
      recall: 0.29 / ledgerWins,
      traps: ["gzip"],
      cited: 4 / 6,
      parallelism: false,
    },
  ])("$name", ({ case: name = "logship", reply, recall, traps, cited, parallelism }) => {
    const fixture = cases[name];
    const score = scoreReply(reply, fixture.truth, fixture.profile);
    expect(score.recall).toBeCloseTo(recall);
    expect(score.traps.toSorted()).toEqual(traps);
    expect(score.cited).toBeCloseTo(cited);
    expect(score.parallelism).toBe(parallelism);
    expect(score.composite).toBeCloseTo(recall - 0.5 * traps.length);
  });
});

test("scoreResults scores each trace by its case's kind and names the plugin arm", async () => {
  const results = mkdtempSync(join(tmpdir(), "frame-"));
  const notes = await example("docsync", "pass/bench/CLIMB.md");
  const trace = (result: string, written?: string) =>
    [
      written === undefined
        ? { type: "system" }
        : {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "Write",
                  input: { file_path: "/w/bench/CLIMB.md", content: written },
                },
              ],
            },
          },
      { type: "result", result },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n");
  await Bun.write(join(results, "traces", "logship-with-0.jsonl"), trace(pass));
  await Bun.write(join(results, "traces", "logship-without-0.jsonl"), trace("1. `fanOut`"));
  await Bun.write(join(results, "traces", "docsync-with-0.jsonl"), trace("Done.", notes));
  const runs = await scoreResults(suite, results, "main");
  expect(runs.map((r) => [r.case, r.arm, r.composite])).toEqual([
    ["docsync", "main", 1],
    ["logship", "main", 1],
    ["logship", "without", -0.5],
  ]);
});

test("render", () => {
  const run = (arm: string, n: number, composite: number): ScoredRun => ({
    case: "logship",
    family: "ranking",
    group: "logship",
    arm,
    run: n,
    composite,
    metrics: { recall: Math.max(composite, 0), traps: composite < 0 ? 1 : 0, cited: 1 },
  });
  const decide = (name: string, arm: string, composite: number): ScoredRun => ({
    case: name,
    family: "decide",
    group: name.split("-")[1] ?? name,
    arm,
    run: 0,
    composite,
    metrics: { decision: Math.ceil(composite), reason: Math.floor(composite) },
  });
  expect(
    render([
      run("main", 0, 1),
      run("main", 1, 1),
      run("pr", 0, 1),
      run("without", 0, -0.5),
      decide("decide-load-cli", "main", 0),
      decide("decide-load-cli", "pr", 1),
      decide("decide-win-cli", "main", 1),
      decide("decide-win-cli", "pr", 0.5),
    ]),
  ).toMatchSnapshot();
});
