import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import seedrandom from "seedrandom";
import type { Judgment, Key, Label, Pair, Pick } from "./pairs";
import {
  agreementOf,
  blind,
  buildPairs,
  calibrate,
  changedRegion,
  collectDrafts,
  compareLabels,
  deblindPick,
  extractDeliverable,
  extractOut,
  extractWrite,
  formatCalibration,
  formatScore,
  isFresh,
  judgePair,
  leftPickShare,
  mapPool,
  parseMap,
  renderJudgePrompt,
  scoreJudgments,
  signFlipPValue,
  surfaceFor,
  wilson,
  winValue,
} from "./pairwise";

const assistant = (...blocks: object[]) => ({ type: "assistant", message: { content: blocks } });
const toolUse = (name: string, input: object) => ({ type: "tool_use", name, input });
const trace = (...lines: object[]) =>
  [...lines, { type: "result", result: "" }].map((l) => JSON.stringify(l)).join("\n");
const traceWithReply = (reply: string, ...lines: object[]) =>
  [...lines, { type: "result", result: reply }].map((l) => JSON.stringify(l)).join("\n");

describe("extractOut", () => {
  test.each([
    { reply: "before <out>hello</out> after", expected: "hello" },
    { reply: "<out>\n  multi\n  line\n</out>", expected: "multi\n  line" },
    { reply: "no tags here", expected: undefined },
  ])("extractOut($reply)", ({ reply, expected }) => {
    expect(extractOut(reply)).toBe(expected);
  });
});

describe("extractWrite", () => {
  test("returns the Write content for a matching path", () => {
    const t = trace(assistant(toolUse("Write", { file_path: "/tmp/out.md", content: "v1" })));
    expect(extractWrite(t, "/tmp/out.md")).toBe("v1");
  });

  test("undefined when the trace never touches the path", () => {
    const t = trace(assistant(toolUse("Write", { file_path: "/tmp/other.md", content: "v1" })));
    expect(extractWrite(t, "/tmp/out.md")).toBeUndefined();
  });

  test("an Edit replaces only the first occurrence by default", () => {
    const t = trace(
      assistant(toolUse("Write", { file_path: "/tmp/out.md", content: "a a" })),
      assistant(toolUse("Edit", { file_path: "/tmp/out.md", old_string: "a", new_string: "b" })),
    );
    expect(extractWrite(t, "/tmp/out.md")).toBe("b a");
  });

  test("an Edit with replace_all replaces every occurrence", () => {
    const t = trace(
      assistant(toolUse("Write", { file_path: "/tmp/out.md", content: "a a" })),
      assistant(
        toolUse("Edit", {
          file_path: "/tmp/out.md",
          old_string: "a",
          new_string: "b",
          replace_all: true,
        }),
      ),
    );
    expect(extractWrite(t, "/tmp/out.md")).toBe("b b");
  });

  test("a Write after an Edit wins: last call replaying in order", () => {
    const t = trace(
      assistant(toolUse("Write", { file_path: "/tmp/out.md", content: "first" })),
      assistant(
        toolUse("Edit", { file_path: "/tmp/out.md", old_string: "first", new_string: "second" }),
      ),
      assistant(toolUse("Write", { file_path: "/tmp/out.md", content: "third" })),
    );
    expect(extractWrite(t, "/tmp/out.md")).toBe("third");
  });

  test("an Edit against a path never Written is dropped, not treated as the whole file", () => {
    const t = trace(
      assistant(toolUse("Edit", { file_path: "/tmp/out.md", old_string: "a", new_string: "b" })),
    );
    expect(extractWrite(t, "/tmp/out.md")).toBeUndefined();
  });
});

describe("extractDeliverable", () => {
  test("uses the <out> block from the final reply when no file path is given", () => {
    expect(extractDeliverable(traceWithReply("<out>body</out>"))).toBe("body");
  });

  test("uses the last Write/Edit at the given path when one is given", () => {
    const t = traceWithReply(
      "<out>ignored</out>",
      assistant(toolUse("Write", { file_path: "/tmp/skill.md", content: "skill text" })),
    );
    expect(extractDeliverable(t, "/tmp/skill.md")).toBe("skill text");
  });
});

async function writeTrace(dir: string, file: string, text: string): Promise<void> {
  await Bun.write(join(dir, "traces", file), text);
}

describe("collectDrafts", () => {
  test("pools with-arm runs across paths in order and skips without-arm runs", async () => {
    const a = mkdtempSync(join(tmpdir(), "pairwise-"));
    const b = mkdtempSync(join(tmpdir(), "pairwise-"));
    await Promise.all([
      writeTrace(a, "pr-quiet-with-0.jsonl", traceWithReply("<out>a0</out>")),
      writeTrace(a, "pr-quiet-without-0.jsonl", traceWithReply("<out>ignored</out>")),
      writeTrace(b, "pr-quiet-with-0.jsonl", traceWithReply("<out>b0</out>")),
    ]);
    const drafts = await collectDrafts(
      [join(a, "aggregate-result.json"), join(b, "aggregate-result.json")],
      () => undefined,
    );
    expect(drafts.get("pr-quiet")).toEqual(["a0", "b0"]);
  });

  test("sorts runs numerically, not lexically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pairwise-"));
    await Promise.all([
      writeTrace(dir, "c-with-10.jsonl", traceWithReply("<out>ten</out>")),
      writeTrace(dir, "c-with-2.jsonl", traceWithReply("<out>two</out>")),
    ]);
    const drafts = await collectDrafts([dir], () => undefined);
    expect(drafts.get("c")).toEqual(["two", "ten"]);
  });

  test("applies a per-case file override for extraction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pairwise-"));
    await writeTrace(
      dir,
      "doc-readme-with-0.jsonl",
      traceWithReply(
        "<out>ignored</out>",
        assistant(toolUse("Write", { file_path: "/tmp/README.md", content: "doc body" })),
      ),
    );
    const drafts = await collectDrafts([dir], (c) =>
      c === "doc-readme" ? "/tmp/README.md" : undefined,
    );
    expect(drafts.get("doc-readme")).toEqual(["doc body"]);
  });
});

describe("parseMap", () => {
  test.each<{ entries: string[]; expected: [string, string][] }>([
    {
      entries: ["a=1", "b=2"],
      expected: [
        ["a", "1"],
        ["b", "2"],
      ],
    },
    { entries: [], expected: [] },
  ])("parseMap($entries)", ({ entries, expected }) => {
    expect([...parseMap(entries)]).toEqual(expected);
  });

  test("rejects an entry with no =", () => {
    expect(() => parseMap(["broken"])).toThrow("expected case=value");
  });
});

describe("changedRegion", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].join("\n");

  test.each<{ name: string; after: string; expected: string }>([
    { name: "unchanged file", after: before, expected: "" },
    {
      name: "one inserted line keeps one line of context",
      after: before.replace("e", "e\nNEW"),
      expected: "…\nd\ne\nNEW\nf\ng\n…",
    },
    { name: "an edit at the top", after: before.replace("a", "A"), expected: "A\nb\nc\n…" },
    {
      name: "two distant edits become two hunks",
      after: before.replace("a", "A").replace("i", "I"),
      expected: "A\nb\nc\n…\ng\nh\nI",
    },
  ])("$name", ({ after, expected }) => {
    expect(changedRegion(before, after, 2)).toBe(expected);
  });

  test("the region holds every inserted line", () => {
    hegel.test((tc) => {
      const lines = tc.draw(gs.arrays(gs.text({ alphabet: "abc" }), { maxSize: 12 }));
      const at = tc.draw(gs.integers({ minValue: 0, maxValue: lines.length }));
      const inserted = tc.draw(gs.text({ alphabet: "XYZ", minSize: 1 }));
      const after = [...lines.slice(0, at), inserted, ...lines.slice(at)].join("\n");
      expect(changedRegion(lines.join("\n"), after, 0)).toContain(inserted);
    });
  });
});

describe("surfaceFor", () => {
  const tags = new Map([
    ["pr-quiet", ["dev", "pr"]],
    ["ambiguous", ["dev", "pr", "issue"]],
    ["untagged", ["dev"]],
  ]);

  test("reads the one SURFACES tag a case carries", () => {
    expect(surfaceFor("pr-quiet", tags, new Map())).toBe("pr");
  });

  test("falls back to the case id's surface prefix when no tag names one", () => {
    expect(surfaceFor("doc-001", new Map([["doc-001", ["dev"]]]), new Map())).toBe("doc");
  });

  test("an override wins over the tags", () => {
    expect(surfaceFor("pr-quiet", tags, new Map([["pr-quiet", "issue"]]))).toBe("issue");
  });

  test.each(["ambiguous", "untagged", "missing"])(
    "throws when %s has no single surface tag",
    (c) => {
      expect(() => surfaceFor(c, tags, new Map())).toThrow(/expected exactly one of/);
    },
  );
});

async function writeCase(
  suite: string,
  name: string,
  tags: string[],
  prompt: string,
): Promise<void> {
  await Bun.write(
    join(suite, name, "case.yaml"),
    `schema_version: "1.1"\nname: ${name}\ntags: [${tags.join(", ")}]\n`,
  );
  await Bun.write(join(suite, name, "prompt.md"), prompt);
}

describe("buildPairs", () => {
  test("pairs base and candidate run-for-run, capped at the shorter side", async () => {
    const suite = mkdtempSync(join(tmpdir(), "pairwise-suite-"));
    await writeCase(suite, "pr-quiet", ["dev", "pr"], "Open a quiet PR.");
    const base = mkdtempSync(join(tmpdir(), "pairwise-base-"));
    const candidate = mkdtempSync(join(tmpdir(), "pairwise-candidate-"));
    await Promise.all([
      writeTrace(base, "pr-quiet-with-0.jsonl", traceWithReply("<out>base0</out>")),
      writeTrace(base, "pr-quiet-with-1.jsonl", traceWithReply("<out>base1</out>")),
      writeTrace(candidate, "pr-quiet-with-0.jsonl", traceWithReply("<out>cand0</out>")),
    ]);
    const pairs = await buildPairs({
      suite,
      base: join(base, "aggregate-result.json"),
      candidate: join(candidate, "aggregate-result.json"),
      original: undefined,
      field: "original",
      out: undefined,
      file: [],
      surface: [],
      baseLabel: "base",
      candidateLabel: "candidate",
    });
    expect(pairs).toEqual([
      {
        id: "pr-quiet-base-candidate-0",
        case: "pr-quiet",
        surface: "pr",
        brief: "Open a quiet PR.",
        a: { source: { kind: "run", column: "base", arm: "with", run: 0 }, text: "base0" },
        b: { source: { kind: "run", column: "candidate", arm: "with", run: 0 }, text: "cand0" },
      },
    ]);
  });

  test("original mode pairs every candidate run against the same original text", async () => {
    const suite = mkdtempSync(join(tmpdir(), "pairwise-suite-"));
    await writeCase(suite, "doc-readme", ["dev", "doc"], "Write the README section.");
    const candidate = mkdtempSync(join(tmpdir(), "pairwise-candidate-"));
    const originals = mkdtempSync(join(tmpdir(), "pairwise-originals-"));
    await Promise.all([
      writeTrace(candidate, "doc-readme-with-0.jsonl", traceWithReply("<out>c0</out>")),
      Bun.write(
        join(originals, "doc-readme.json"),
        JSON.stringify({ url: "https://example.invalid/pr/1", original: "Ben's text" }),
      ),
    ]);
    const pairs = await buildPairs({
      suite,
      base: undefined,
      candidate: join(candidate, "aggregate-result.json"),
      original: originals,
      field: "original",
      out: undefined,
      file: [],
      surface: [],
      baseLabel: "base",
      candidateLabel: "candidate",
    });
    expect(pairs).toEqual([
      {
        id: "doc-readme-original-candidate-0",
        case: "doc-readme",
        surface: "doc",
        brief: "Write the README section.",
        a: {
          source: { kind: "original", url: "https://example.invalid/pr/1" },
          text: "Ben's text",
        },
        b: { source: { kind: "run", column: "candidate", arm: "with", run: 0 }, text: "c0" },
      },
    ]);
  });

  const validFlags = {
    suite: "s" as string | undefined,
    base: "b" as string | undefined,
    candidate: "c" as string | undefined,
    original: undefined as string | undefined,
    field: "original",
    out: undefined,
    file: [] as string[],
    surface: [] as string[],
    baseLabel: "base",
    candidateLabel: "candidate",
  };

  test.each<{ flags: typeof validFlags; message: string }>([
    { flags: { ...validFlags, suite: undefined }, message: "--suite is required" },
    { flags: { ...validFlags, candidate: undefined }, message: "--candidate is required" },
    { flags: { ...validFlags, base: "x", original: "y" }, message: "mutually exclusive" },
    {
      flags: { ...validFlags, base: undefined, original: undefined },
      message: "one of --base or --original",
    },
  ])("rejects an invalid flag combination", ({ flags, message }) => {
    expect(buildPairs(flags)).rejects.toThrow(message);
  });
});

describe("blind / deblindPick", () => {
  test.each<{ flip: boolean; left: Key }>([
    { flip: false, left: "a" },
    { flip: true, left: "b" },
  ])("blind($flip) puts $left on the left", ({ flip, left }) => {
    expect(blind(flip)).toBe(left);
  });

  test.each<{ raw: "1" | "2" | "tie"; left: Key; expected: Pick }>([
    { raw: "1", left: "a", expected: "a" },
    { raw: "2", left: "a", expected: "b" },
    { raw: "1", left: "b", expected: "b" },
    { raw: "2", left: "b", expected: "a" },
    { raw: "tie", left: "a", expected: "tie" },
  ])("deblindPick($raw, $left) -> $expected", ({ raw, left, expected }) => {
    expect(deblindPick(raw, left)).toBe(expected);
  });
});

describe("renderJudgePrompt", () => {
  const pair: Pair = {
    id: "p1",
    case: "c",
    surface: "pr",
    brief: "the brief",
    a: { source: { kind: "run", column: "base", arm: "with", run: 0 }, text: "draft A" },
    b: { source: { kind: "run", column: "candidate", arm: "with", run: 0 }, text: "draft B" },
  };

  test("substitutes brief/left/right for the given left key", () => {
    expect(renderJudgePrompt("{{brief}} | {{left}} | {{right}}", pair, "a")).toBe(
      "the brief | draft A | draft B",
    );
  });

  test("swapping left flips which draft renders where", () => {
    expect(renderJudgePrompt("{{left}} | {{right}}", pair, "b")).toBe("draft B | draft A");
  });
});

describe("judgePair", () => {
  const pair: Pair = {
    id: "p1",
    case: "c",
    surface: "pr",
    brief: "brief",
    a: { source: { kind: "run", column: "base", arm: "with", run: 0 }, text: "A" },
    b: { source: { kind: "run", column: "candidate", arm: "with", run: 0 }, text: "B" },
  };

  test("de-blinds a single verdict to a/b", async () => {
    const call = () => Promise.resolve({ reason: "b wins", pick: "2" as const });
    const judgment = await judgePair(
      pair,
      "{{left}}/{{right}}",
      "hash",
      "model",
      false,
      call,
      () => 1,
    );
    expect(judgment).toEqual({
      id: "p1",
      pick: "b",
      left: "a",
      reason: "b wins",
      prompt: "hash",
      model: "model",
    });
  });

  test("swap agreement keeps the pick", async () => {
    let n = 0;
    const call = () => {
      n++;
      return Promise.resolve({
        reason: `call ${n}`,
        pick: n === 1 ? ("2" as const) : ("1" as const),
      });
    };
    const judgment = await judgePair(pair, "{{left}}", "hash", "model", true, call, () => 1);
    expect(judgment.pick).toBe("b");
  });

  test("swap disagreement forces a tie", async () => {
    let n = 0;
    const call = () => {
      n++;
      return Promise.resolve({ reason: `call ${n}`, pick: "1" as const });
    };
    const judgment = await judgePair(pair, "{{left}}", "hash", "model", true, call, () => 1);
    expect(judgment.pick).toBe("tie");
    expect(judgment.reason).toContain("swap disagreement");
  });
});

describe("isFresh", () => {
  test.each<{ existing: Judgment | undefined; hash: string; expected: boolean }>([
    { existing: undefined, hash: "h", expected: false },
    {
      existing: { id: "p1", pick: "a", left: "a", reason: "", prompt: "h", model: "m" },
      hash: "h",
      expected: true,
    },
    {
      existing: { id: "p1", pick: "a", left: "a", reason: "", prompt: "old", model: "m" },
      hash: "h",
      expected: false,
    },
  ])("isFresh -> $expected", ({ existing, hash, expected }) => {
    expect(isFresh(existing, hash)).toBe(expected);
  });
});

describe("mapPool", () => {
  test("runs every item and preserves result order regardless of concurrency", async () => {
    const results = await mapPool([1, 2, 3, 4, 5], 2, (n) => Promise.resolve(n * 10));
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  test("never exceeds the requested concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(1);
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("winValue", () => {
  test.each<{ pick: Pick; expected: number }>([
    { pick: "a", expected: 0 },
    { pick: "b", expected: 1 },
    { pick: "tie", expected: 0.5 },
  ])("winValue($pick) -> $expected", ({ pick, expected }) => {
    expect(winValue(pick)).toBe(expected);
  });
});

describe("signFlipPValue", () => {
  test("returns NaN when every pair tied", () => {
    expect(signFlipPValue([0.5, 0.5, 0.5])).toBeNaN();
  });

  test("a unanimous win for b is extreme", () => {
    const rng = seedrandom("test-a");
    expect(signFlipPValue([1, 1, 1, 1, 1, 1, 1, 1], 2000, rng)).toBeLessThan(0.05);
  });

  test("an even split is not extreme", () => {
    const rng = seedrandom("test-b");
    expect(signFlipPValue([1, 0, 1, 0, 1, 0], 2000, rng)).toBeGreaterThan(0.5);
  });

  test("is deterministic under a seeded rng", () => {
    const wins = [1, 1, 0, 1, 0.5, 1, 0];
    const a = signFlipPValue(wins, 500, seedrandom("same-seed"));
    const b = signFlipPValue(wins, 500, seedrandom("same-seed"));
    expect(a).toBe(b);
  });
});

describe("leftPickShare", () => {
  const j = (pick: Pick, left: Key): Judgment => ({
    id: "x",
    pick,
    left,
    reason: "",
    prompt: "h",
    model: "m",
  });

  test.each([
    { judgments: [j("a", "a"), j("b", "a")], expected: 0.5 },
    { judgments: [j("a", "a"), j("b", "b")], expected: 1 },
    { judgments: [j("tie", "a")], expected: Number.NaN },
  ])("leftPickShare -> $expected", ({ judgments, expected }) => {
    expect(leftPickShare(judgments)).toBe(expected);
  });
});

describe("scoreJudgments / formatScore", () => {
  const pairs: Pair[] = [
    {
      id: "p1",
      case: "pr-quiet",
      surface: "pr",
      brief: "b",
      a: { source: { kind: "run", column: "base", arm: "with", run: 0 }, text: "a" },
      b: { source: { kind: "run", column: "candidate", arm: "with", run: 0 }, text: "b" },
    },
    {
      id: "p2",
      case: "pr-quiet",
      surface: "pr",
      brief: "b",
      a: { source: { kind: "run", column: "base", arm: "with", run: 1 }, text: "a" },
      b: { source: { kind: "run", column: "candidate", arm: "with", run: 1 }, text: "b" },
    },
  ];
  const judgments: Judgment[] = [
    { id: "p1", pick: "b", left: "a", reason: "", prompt: "h", model: "m" },
    { id: "p2", pick: "b", left: "b", reason: "", prompt: "h", model: "m" },
  ];

  test("scores per case and overall", () => {
    const report = scoreJudgments(pairs, judgments, "score-seed");
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0]).toMatchObject({ case: "pr-quiet", n: 2, winRate: 1 });
    expect(report.overall.n).toBe(2);
    expect(report.overall.winRate).toBe(1);
    expect(report.leftPickShare).toBe(0.5);
  });

  test("formatScore snapshot", () => {
    const report = scoreJudgments(pairs, judgments, "snapshot-seed");
    expect(formatScore(report, 0.1)).toMatchSnapshot();
  });
});

describe("wilson", () => {
  test.each<{ hits: number; total: number; expected?: number[] }>([
    { hits: 0, total: 0, expected: [0, 1] },
    { hits: 10, total: 10 },
    { hits: 0, total: 10 },
  ])("wilson($hits, $total) stays within [0, 1]", ({ hits, total, expected }) => {
    const [lo, hi] = wilson(hits, total);
    if (expected) expect([lo, hi]).toEqual(expected);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeLessThanOrEqual(hi);
  });

  test("a wider sample at the same rate narrows the interval", () => {
    const [lo1, hi1] = wilson(7, 10);
    const [lo2, hi2] = wilson(70, 100);
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1);
  });
});

describe("compareLabels / agreementOf / calibrate / formatCalibration", () => {
  const labels: Label[] = [
    { id: "p1", pick: "b", left: "a", spans: [], notes: "" },
    { id: "p2", pick: "a", left: "a", spans: [], notes: "" },
    { id: "p3", pick: "tie", left: "a", spans: [], notes: "" },
    { id: "p4", pick: "a", left: "a", spans: [], notes: "" },
  ];
  const judgments: Judgment[] = [
    { id: "p1", pick: "b", left: "a", reason: "", prompt: "h", model: "m" },
    { id: "p2", pick: "b", left: "a", reason: "", prompt: "h", model: "m" },
    { id: "p3", pick: "a", left: "a", reason: "", prompt: "h", model: "m" },
  ];
  const surfaces = new Map([
    ["p1", "pr"],
    ["p2", "pr"],
    ["p3", "doc"],
  ]);

  test("excludes either-side ties from the decided denominator", () => {
    const comparisons = compareLabels(labels, judgments, surfaces);
    expect(comparisons).toEqual([
      { id: "p1", surface: "pr", tie: false, agree: true },
      { id: "p2", surface: "pr", tie: false, agree: false },
      { id: "p3", surface: "doc", tie: true, agree: false },
    ]);
    // p4 has no matching judgment and drops out entirely.
  });

  test("agreementOf reports rate over decided pairs, ties counted separately", () => {
    const comparisons = compareLabels(labels, judgments, surfaces);
    const agreement = agreementOf(comparisons);
    expect(agreement).toMatchObject({ n: 3, ties: 1, agree: 1, decided: 2, rate: 0.5 });
  });

  test("calibrate rolls up per surface and overall", () => {
    const report = calibrate(compareLabels(labels, judgments, surfaces));
    expect(report.bySurface.map(([s]) => s)).toEqual(["doc", "pr"]);
    expect(report.overall.decided).toBe(2);
  });

  test("formatCalibration snapshot", () => {
    const report = calibrate(compareLabels(labels, judgments, surfaces));
    expect(formatCalibration(report, 0.75)).toMatchSnapshot();
  });
});
