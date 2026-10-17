import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Block, citedShare, cites, listBlocks, profileRefs, Truth } from "./ranking";

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

describe("citedShare", () => {
  test.each<{
    name: string;
    case?: keyof typeof cases;
    reply: string;
    cited: number;
  }>([
    {
      name: "the pass example",
      reply: pass,
      cited: 1,
    },
    {
      name: "the trap-first example",
      reply: trapFirst,
      cited: 0.5,
    },
    {
      name: "a win that dismisses a trap in passing",
      reply:
        "1. Map in `dedupe`, not the mutex.\n2. Hoist `regexp.MustCompile`.\n3. Mutex in `Stats.Inc`.",
      cited: 1,
    },
    {
      name: "a win ranked past five",
      reply: "1. `fanOut`\n2. a\n3. b\n4. c\n5. d\n6. `dedupe`\n7. `regexp.MustCompile`",
      cited: 3 / 7,
    },
    {
      name: "a ranked table",
      reply: "| Rank | Candidate |\n| --- | --- |\n| 1 | dedupe map |\n| 2 | MustCompile hoist |",
      cited: 1,
    },
    {
      name: "a regex hoist named verb first",
      reply:
        "1. Hoist the two regexes to package-level `var`s.\n2. Replace the O(n²) scan in `dedupe`.",
      cited: 0.5,
    },
    {
      name: "no list",
      reply: "Profile first.",
      cited: 0,
    },
    {
      name: "the ledgerroll pass example",
      case: "ledgerroll",
      reply: ledgerPass,
      cited: 1,
    },
    {
      name: "the ledgerroll raw-share example",
      case: "ledgerroll",
      reply: byShare,
      cited: 1,
    },
    {
      name: "parallelism set aside outside the list",
      case: "ledgerroll",
      reply: paragraphParallel,
      cited: 1,
    },
    {
      name: "a ledgerroll win that names gzip in passing",
      case: "ledgerroll",
      reply:
        "1. Typed struct in `decodeRecord`, since gzip is fixed.\n2. `sort.Slice` once per group.",
      cited: 1,
    },
    {
      name: "a resort described without naming sort.Slice",
      case: "ledgerroll",
      reply: "1. Sort each group once after grouping, instead of after every append (0.60 s).",
      cited: 1,
    },
    {
      name: "shares cited as rounded percentages",
      case: "ledgerroll",
      reply:
        "1. Fix the aggregate sort (`sort.Slice`, 10% of CPU).\n2. Replace `fmt.Sprintf` in render and `groupKey` (14% of CPU).\n3. Reuse the JSON decoder and struct in `decodeRecord` (17% cumulative).\n4. Reduce allocations to cut GC (8% of CPU).",
      cited: 1,
    },
    {
      name: "a ledgerroll win ranked sixth",
      case: "ledgerroll",
      reply: "1. gzip\n2. GC\n3. `decodeRecord`\n4. `sort.Slice`\n5. `renderRow`\n6. `groupKey`",
      cited: 4 / 6,
    },
  ])("$name", ({ case: name = "logship", reply, cited }) => {
    const fixture = cases[name];
    expect(citedShare(reply, fixture.truth, fixture.profile)).toBeCloseTo(cited);
  });
});
