import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import {
  checkouts,
  corpusHits,
  countWords,
  filePath,
  lintFiles,
  markShipped,
  PLUGINS,
  sweep,
} from "./corpus";
import {
  assign,
  type Flag,
  type Hit,
  hitId,
  type Label,
  latest,
  type Pattern,
  type Score,
  store,
} from "./data";
import { sample } from "./sample";
import { CEILING, type Features, measure } from "./complexity";
import {
  best,
  clears,
  diffHits,
  evidence,
  judge,
  labConfig,
  overlaps,
  type Stage,
  score,
  stage,
  wideConfig,
} from "./score";
import { locate, toFlags } from "./review";
import type { Message, QueryFn } from "../eval-judge/index";
import { type Call, next, PROPOSED, toCall } from "./deck";
import { propose, type Reply, resolve, spread } from "./propose";
import { context, reveal, serve } from "./server";
import { checkRows } from "./status";

function hit(file: string, line: number, span: [number, number], check = "Writing.X"): Hit {
  return {
    plugin: "writing",
    check,
    severity: "warning",
    message: "",
    file,
    line,
    span,
    match: "",
  };
}

function label(
  at: Hit,
  verdict: Label["verdict"],
  pattern?: string,
  by: Label["by"] = "user",
): Label {
  return { ...at, id: hitId(at), verdict, note: "", pattern, by, ts: "t" };
}

function flag(file: string, line: number, span: [number, number], pattern?: string): Flag {
  return {
    id: `${file}|${line}|${span[0]}`,
    pattern,
    file,
    line,
    span,
    match: "",
    note: "",
    ts: "t",
  };
}

const pattern: Pattern = { slug: "p", description: "", style: "Writing" };

function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    pattern: "p",
    candidate: "c",
    hits: 10,
    right: 10,
    wrong: 0,
    byModel: 0,
    low: 0.7,
    high: 1,
    recall: 1,
    positives: 8,
    perThousand: 0,
    complexity: 0,
    ts: "t",
    ...overrides,
  };
}

test.each<{
  name: string;
  a: [string, number, number, number];
  b: [string, number, number, number];
  want: boolean;
}>([
  { name: "shared columns", a: ["f", 1, 5, 9], b: ["f", 1, 9, 12], want: true },
  { name: "adjacent columns", a: ["f", 1, 5, 9], b: ["f", 1, 10, 12], want: false },
  { name: "another line", a: ["f", 1, 5, 9], b: ["f", 2, 5, 9], want: false },
  { name: "another file", a: ["f", 1, 5, 9], b: ["g", 1, 5, 9], want: false },
])("overlaps: $name", ({ a, b, want }) => {
  expect(overlaps(hit(a[0], a[1], [a[2], a[3]]), hit(b[0], b[1], [b[2], b[3]]))).toBe(want);
});

describe("judge", () => {
  test("counts a hit on bad prose as right whatever check labeled it, and skips unsure spans", () => {
    const labels = [
      label(hit("a", 1, [1, 5], "ai-tells.Y"), "right"),
      label(hit("a", 2, [1, 5]), "wrong"),
      label(hit("a", 3, [1, 5]), "unsure"),
    ];
    const hits = [
      hit("a", 1, [3, 4], "Lab.C"),
      hit("a", 2, [1, 2], "Lab.C"),
      hit("a", 3, [1, 2], "Lab.C"),
      hit("a", 4, [1, 2], "Lab.C"),
      hit("b", 1, [1, 2], "Lab.C"),
    ];
    const judged = judge(hits, labels, [flag("b", 1, [1, 9], "q")]);
    expect({
      right: judged.right,
      wrong: judged.wrong,
      unlabeled: judged.unlabeled.map((h) => h.line),
    }).toEqual({ right: 2, wrong: 1, unlabeled: [4] });
  });

  test("the user's label overrides a model's, and a model-only verdict counts as byModel", () => {
    const at = hit("a", 1, [1, 5]);
    const other = hit("a", 2, [1, 5]);
    const labels = [
      label(at, "right", undefined, "model"),
      label(at, "wrong"),
      label(other, "right", undefined, "model"),
    ];
    expect(judge([at, other], labels, [])).toMatchObject({ right: 1, wrong: 1, byModel: 1 });
  });
});

describe("stage", () => {
  const positives = (count: number, files: number): Label[] =>
    Array.from({ length: count }, (_, i) =>
      label(hit(`f${i % files}`, i + 1, [1, 2]), "right", "p"),
    );
  const top = (right: number, wrong: number, low: number, complexity = 0): Score =>
    makeScore({ hits: right + wrong, right, wrong, low, complexity });

  test.each<{ name: string; labels: Label[]; best?: Score; want: Stage }>([
    {
      name: "seven positives keep collecting",
      labels: positives(7, 7),
      best: top(20, 0, 0.9),
      want: "collecting",
    },
    {
      name: "eight positives in three files keep collecting",
      labels: positives(8, 3),
      best: top(20, 0, 0.9),
      want: "collecting",
    },
    {
      name: "enough positives with no candidate generalize",
      labels: positives(8, 4),
      want: "generalizing",
    },
    {
      name: "a candidate under ten labeled hits is not ready",
      labels: positives(8, 4),
      best: top(9, 0, 0.7),
      want: "generalizing",
    },
    {
      name: "a candidate under the floor is not ready",
      labels: positives(8, 4),
      best: top(10, 4, 0.45),
      want: "generalizing",
    },
    {
      name: "a candidate over the floor is ready",
      labels: positives(8, 4),
      best: top(12, 0, 0.75),
      want: "ready",
    },
    {
      name: "a candidate over the complexity ceiling is not ready",
      labels: positives(8, 4),
      best: top(12, 0, 0.75, CEILING + 1),
      want: "generalizing",
    },
  ])("$name", ({ labels, best: candidate, want }) => {
    expect(stage(pattern, evidence("p", labels, []), candidate)).toBe(want);
  });

  test("a pattern with a check is shipped", () => {
    expect(stage({ ...pattern, check: "Writing.P" }, evidence("p", [], []), undefined)).toBe(
      "shipped",
    );
  });

  test("clears needs both the count and the floor", () => {
    expect([
      clears({ right: 10, wrong: 0, low: 0.72 }),
      clears({ right: 9, wrong: 0, low: 0.7 }),
    ]).toEqual([true, false]);
  });
});

test("score reports recall over the pattern's labels and flags", () => {
  const labels = [
    label(hit("a", 1, [1, 5]), "right", "p"),
    label(hit("a", 2, [1, 5]), "right", "other"),
  ];
  const flags = [flag("b", 1, [1, 5], "p"), flag("b", 2, [1, 5], "p")];
  const { score: s } = score(
    "p",
    "c",
    [hit("a", 1, [2, 3], "Lab.c"), hit("b", 1, [1, 1], "Lab.c")],
    labels,
    flags,
    2000,
    0,
    "t",
  );
  expect({
    recall: s.recall,
    positives: s.positives,
    right: s.right,
    perThousand: s.perThousand,
  }).toEqual({ recall: 2 / 3, positives: 3, right: 2, perThousand: 1 });
});

test.each<{ name: string; scores: Score[]; want: string }>([
  {
    name: "a simpler candidate within the top interval wins",
    scores: [
      makeScore({ candidate: "precise", low: 0.7, high: 0.95, complexity: 9 }),
      makeScore({ candidate: "simple", low: 0.65, high: 0.9, complexity: 1 }),
    ],
    want: "simple",
  },
  {
    name: "a simpler candidate whose interval misses the top floor loses",
    scores: [
      makeScore({ candidate: "precise", low: 0.7, high: 0.95, complexity: 9 }),
      makeScore({ candidate: "simple", low: 0.3, high: 0.6, complexity: 1 }),
    ],
    want: "precise",
  },
  {
    name: "a simpler candidate with too few labels for its wide interval loses",
    scores: [
      makeScore({ candidate: "precise", low: 0.7, high: 0.95, complexity: 9 }),
      makeScore({ candidate: "unlabeled", hits: 0, right: 0, low: 0, high: 1, complexity: 1 }),
    ],
    want: "precise",
  },
  {
    name: "a precise candidate over the ceiling yields to a promotable one",
    scores: [
      makeScore({ candidate: "precise", low: 0.96, high: 1, complexity: CEILING + 1 }),
      makeScore({ candidate: "simple", low: 0.83, high: 0.94, complexity: 1 }),
    ],
    want: "simple",
  },
])("best: $name", ({ scores, want }) => {
  expect(best(scores, "p")?.candidate).toBe(want);
});

test.each<{ name: string; yaml: string; want: Partial<Features> }>([
  {
    name: "a plain word list",
    yaml: "tokens:\n  - foo\n  - bar|baz\n",
    want: { lookarounds: 0, gaps: 0, exceptionWords: 0, branches: 1, tokens: 2 },
  },
  {
    name: "a negative lookahead counts its alternatives as exception words",
    yaml: "tokens:\n  - '(?i)hi (?!there|team|all)\\w+'\n",
    want: { lookarounds: 1, exceptionWords: 3, branches: 0 },
  },
  {
    name: "a wildcard gap across words",
    yaml: "raw:\n  - 'the reason .{0,40} is because'\n  - 'not [\\w\\s]+ but'\n",
    want: { gaps: 2 },
  },
  {
    name: "a separator class is not a gap",
    yaml: "tokens:\n  - 'source[\\s-]+of[\\s-]+truth'\n",
    want: { gaps: 0 },
  },
  {
    name: "a quantified group of open words is a gap, and one of listed words is not",
    yaml: "tokens:\n  - 'no\\s+(?:[a-z-]+\\s+){0,3}(?:(?:is|are)\\s+){0,3}needed'\n",
    want: { gaps: 1 },
  },
  {
    name: "swap keys and the exceptions list",
    yaml: "swap:\n  'a|b': c\nexceptions:\n  - x\n  - y\n",
    want: { branches: 1, exceptions: 2, tokens: 1 },
  },
])("measure: $name", ({ yaml, want }) => {
  expect(measure(yaml).features).toMatchObject(want);
});

test("diffHits matches overlapping hits and reports the rest each way", () => {
  const baseline = [hit("a", 1, [1, 5]), hit("a", 2, [1, 5])];
  const candidate = [hit("a", 1, [3, 8], "Lab.c"), hit("b", 1, [1, 2], "Lab.c")];
  const { kept, dropped, added } = diffHits(baseline, candidate);
  expect([kept, dropped, added].map((list) => list.map((h) => `${h.file}:${h.line}`))).toEqual([
    ["a:1"],
    ["a:2"],
    ["b:1"],
  ]);
});

describe("sample", () => {
  const hits = ["a", "b", "c", "d"].flatMap((file) => [
    hit(file, 1, [1, 2], "X"),
    hit(file, 2, [1, 2], "X"),
  ]);

  test("spreads a check across files and skips labeled hits", () => {
    const picked = sample(hits, [label(hits[0]!, "right")], [], 2);
    expect(picked.map((item) => `${item.file}:${item.line}`)).toEqual(["a:2", "c:1"]);
  });

  test("puts queued candidate hits first", () => {
    const queued = { ...hit("z", 9, [1, 2], "Lab.c"), pattern: "p", candidate: "c" };
    expect(sample(hits, [], [queued], 1)[0]).toMatchObject({ file: "z", candidate: "c" });
  });
});

test("markShipped marks wide hits the shipped config also fires, and keeps any it alone fires", () => {
  const both = hit("a", 1, [1, 2], "W.Both");
  const wideOnly = hit("a", 2, [1, 2], "W.Off");
  const ownOnly = hit("a", 3, [1, 2], "W.Own");
  const marked = markShipped([{ ...both }, ownOnly], [{ ...both }, wideOnly]);
  expect(marked.map((h) => `${h.check}:${h.shipped}`)).toEqual([
    "W.Both:true",
    "W.Off:false",
    "W.Own:true",
  ]);
});

test("countWords leaves fenced code out", () => {
  expect(countWords("One two.\n\n```ts\nconst three = 3;\n```\n\nFour.\n")).toBe(3);
});

test("context splits the line around Vale's one-based inclusive span", () => {
  expect(context({ line: 2, span: [5, 7] }, ["above", "The fox ran.", "below"])).toEqual({
    before: "above",
    pre: "The ",
    marked: "fox",
    post: " ran.",
    after: "below",
  });
});

function checkHits(check: string, count: number, shipped?: boolean): Hit[] {
  return Array.from({ length: count }, (_, i) => ({
    ...hit(check, i + 1, [1, 2], check),
    shipped,
  }));
}

test.each<{ name: string; shipped?: boolean; right: number; wrong: number; want: Call }>([
  { name: "a shipped check above the floor", shipped: true, right: 12, wrong: 0, want: "keep" },
  { name: "a shipped check below the floor", shipped: true, right: 2, wrong: 10, want: "retire" },
  { name: "a narrow sweep's check below the floor", right: 2, wrong: 10, want: "retire" },
  { name: "an off check above the floor", shipped: false, right: 12, wrong: 0, want: "enable" },
  { name: "an off check below the floor", shipped: false, right: 2, wrong: 10, want: "leave off" },
  { name: "a check short of ten labels", shipped: false, right: 9, wrong: 0, want: "open" },
  { name: "a check straddling the floor", shipped: false, right: 7, wrong: 5, want: "open" },
])("checkRows calls $name $want", ({ shipped, right, wrong, want }) => {
  const hits = checkHits("C", right + wrong, shipped);
  const labels = hits.map((h, i) => label(h, i < right ? "right" : "wrong"));
  expect(checkRows(hits, labels, [])).toMatchObject([{ check: "C", right, wrong, call: want }]);
});

describe("next", () => {
  const settledCheck = checkHits("Settled", 20, false);
  const openCheck = checkHits("Open", 20, false);
  const hits = [...settledCheck, ...openCheck];
  const labels = settledCheck.slice(0, 10).map((h) => label(h, "right"));

  test("a decided check leaves the deck and an undecided one stays", () => {
    const seen = new Set<string>();
    const shown: string[] = [];
    for (let i = 0; i < 50; i++) {
      const card = next(hits, labels, [], seen);
      if (card === undefined) break;
      seen.add(hitId(card));
      shown.push(card.check);
    }
    expect(shown).not.toContain("Settled");
    expect(shown).toContain("Open");
  });

  test("returns undefined once every check is decided or exhausted", () => {
    const seen = new Set(openCheck.map(hitId));
    expect(next(hits, labels, [], seen)).toBeUndefined();
  });

  test("prefers the check fewest votes from a call", () => {
    const some = openCheck.slice(0, 3).map((h) => label(h, "right"));
    const fresh = checkHits("Fresh", 3, false);
    expect(next([...openCheck, ...fresh], some, [], new Set())?.check).toBe("Open");
  });

  test.each<{ name: string; right: number; wrong: number; want: number }>([
    { name: "an unlabeled check needs the minimum", right: 0, wrong: 0, want: 10 },
    { name: "a slop streak needs only the rest of the minimum", right: 5, wrong: 0, want: 5 },
    { name: "a fine streak leans below the floor", right: 0, wrong: 4, want: 6 },
    { name: "a decided check needs none", right: 10, wrong: 0, want: 0 },
  ])("toCall: $name", ({ right, wrong, want }) => {
    expect(toCall({ right, wrong })).toBe(want);
  });

  test("picks the hit from the file the check's labels least cover", () => {
    const covered = [hit("a", 1, [1, 2], "X"), hit("a", 2, [1, 2], "X")];
    const other = hit("b", 1, [1, 2], "X");
    expect(next([...covered, other], [label(covered[0]!, "right")], [], new Set())?.file).toBe("b");
  });

  test.each<{ name: string; seen: number; want: string }>([
    { name: "the fourth card", seen: 3, want: PROPOSED },
    { name: "the first card", seen: 0, want: "Open" },
  ])("draws a proposal on $name", ({ seen, want }) => {
    const proposals = checkHits(PROPOSED, 5, false);
    const ids = new Set(Array.from({ length: seen }, (_, i) => `elsewhere-${i}`));
    expect(next([...openCheck, ...proposals], [], [], ids)?.check).toBe(want);
  });
});

test("reveal lists every check on the voted span and rates each after one vote", () => {
  const a = hit("doc.md", 3, [5, 12], "W.A");
  const b = hit("doc.md", 3, [8, 20], "W.B");
  const elsewhere = hit("doc.md", 4, [5, 12], "W.C");
  const hits = [a, b, elsewhere];
  const byCheck = Map.groupBy(hits, (h) => h.check);
  const shown = reveal(a, hits, byCheck, [label(a, "right")], []);
  expect(shown.others).toEqual(["W.B"]);
  expect(shown.ratings.map((row) => `${row.check}:${row.right}`)).toEqual(["W.A:1", "W.B:1"]);
});

describe("store", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "prose-lab-store-"));
  });
  afterAll(() => rm(dir, { recursive: true }));

  test("a relabel supersedes the earlier label", async () => {
    const data = store(dir);
    const at = hit("a", 1, [1, 2]);
    await data.addLabels([label(at, "right")]);
    await data.addLabels([label(at, "wrong", "p")]);
    expect(await data.labels()).toMatchObject([{ verdict: "wrong", pattern: "p" }]);
  });
});

describe("labConfig", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "prose-lab-corpus-"));
    await Bun.write(
      join(root, "doc.md"),
      "# Doc\n\nThe rule carries the weight.\n\nThe box carries books; the shelf holds them.\n",
    );
    await Bun.write(
      join(root, "Carries.yml"),
      "extends: existence\nmessage: \"'%s'\"\nlevel: suggestion\ntokens:\n  - carries the weight\n",
    );
  });
  afterAll(() => rm(root, { recursive: true }));

  test.each(["prompting", "writing"] as const)(
    "lints with the candidate alone under %s's config",
    async (plugin) => {
      const config = await labConfig([join(root, "Carries.yml")], PLUGINS[plugin]);
      const hits = await lintFiles(plugin, config, ["doc.md"], root);
      expect(hits.map((h) => `${h.check}@${h.line}:${h.match}`)).toEqual([
        "Lab.Carries@3:carries the weight",
      ]);
    },
  );

  test("skips a file vale can't read and keeps the other files' hits", async () => {
    await Bun.write(
      join(root, "bad.md"),
      "---\n: [unclosed\n---\n\nThe rule carries the weight.\n",
    );
    const config = await labConfig([join(root, "Carries.yml")], PLUGINS.writing);
    const hits = await lintFiles("writing", config, ["bad.md", "doc.md"], root);
    expect(hits.map((h) => h.file)).toEqual(["doc.md"]);
  });

  test("wideConfig fires a check the shipped config turns off, and the shipped config does not", async () => {
    await Bun.write(
      join(root, "hedge.md"),
      "# Doc\n\nIt is important to note that the box holds books.\n",
    );
    const off = (hits: Hit[]) =>
      hits.filter((h) => h.check === "ai-tells.HedgingPhrases").map((h) => h.match);
    const own = await lintFiles("writing", PLUGINS.writing, ["hedge.md"], root);
    const wide = await lintFiles("writing", await wideConfig(PLUGINS.writing), ["hedge.md"], root);
    expect(off(own)).toEqual([]);
    expect(off(wide).length).toBeGreaterThan(0);
  });

  test("throws when the config is broken", async () => {
    const config = join(root, "missing.ini");
    expect(await lintFiles("writing", config, ["doc.md"], root).catch(() => "threw")).toBe("threw");
  });
});

describe("locate", () => {
  const lines = [
    "# Doc",
    "",
    "Run `lab.ts sweep` before a **sitting** starts.",
    "See [the guide](https://example.com) for more.",
    "",
    "A second paragraph.",
    "Emoji 😀x y.",
    "Made &copy; here today.",
    "It can't be read.",
  ];
  const slices = (quote: string): string[] =>
    locate(lines, quote).map(
      ({ line, span }) => lines[line - 1]?.slice(span[0] - 1, span[1]) ?? "",
    );

  test.each<{ name: string; quote: string; want: string[] }>([
    { name: "plain text", quote: "A second", want: ["A second"] },
    {
      name: "across backticked code",
      quote: "Run lab.ts sweep before",
      want: ["Run `lab.ts sweep` before"],
    },
    { name: "the whole code span", quote: "lab.ts sweep", want: ["`lab.ts sweep`"] },
    { name: "link text", quote: "the guide", want: ["the guide"] },
    {
      name: "across two lines",
      quote: "starts. See the",
      want: ["starts.", "See [the"],
    },
    { name: "missing", quote: "not in the doc", want: [] },
    { name: "a quote that appears twice", quote: "for", want: [] },
    { name: "an astral character", quote: "😀x", want: ["😀x"] },
    { name: "text after a decoded entity", quote: "here today", want: ["here today"] },
    { name: "a curled apostrophe", quote: "can’t be", want: ["can't be"] },
  ])("$name", ({ quote, want }) => {
    expect(slices(quote)).toEqual(want);
  });

  test("finds any run of words from plain paragraphs", () => {
    const words = ["alpha", "beta", "gamma", "delta"];
    const wordsGen = gs.arrays(gs.integers({ minValue: 0, maxValue: words.length - 1 }), {
      minSize: 1,
      maxSize: 6,
    });
    hegel.test((tc) => {
      const paragraphs = tc
        .draw(gs.arrays(wordsGen, { minSize: 1, maxSize: 4 }))
        .map((picks) => picks.map((i) => words[i]).join(" "));
      const raw = paragraphs.join("\n\n").split("\n");
      const all = paragraphs.join(" ").split(" ");
      const start = tc.draw(gs.integers({ minValue: 0, maxValue: all.length - 1 }));
      const end = tc.draw(gs.integers({ minValue: start + 1, maxValue: all.length }));
      const quote = all.slice(start, end).join(" ");
      const found = locate(raw, quote).map(({ line, span }) =>
        raw[line - 1]?.slice(span[0] - 1, span[1]),
      );
      const text = all.join(" ");
      const unique = text.indexOf(quote) === text.lastIndexOf(quote);
      expect(found.join(" ")).toBe(unique ? quote : "");
    });
  });
});

describe("toFlags", () => {
  const lines = ["Run `lab.ts sweep` first."];

  test("turns a comment into an unassigned flag on the raw slice and keeps global notes apart", () => {
    const reviewed = toFlags(
      [
        { type: "COMMENT", text: "jargon", originalText: "lab.ts sweep" },
        { type: "GLOBAL_COMMENT", text: "too terse" },
        { type: "COMMENT", text: "gone", originalText: "edited away" },
        { type: "DELETION", text: "", originalText: "first" },
      ],
      "d.md",
      lines,
      "t",
    );
    expect(reviewed).toEqual({
      flags: [
        {
          id: "d.md|1|5",
          file: "d.md",
          line: 1,
          span: [5, 18],
          match: "`lab.ts sweep`",
          note: "jargon",
          ts: "t",
        },
        {
          id: "d.md|1|20",
          file: "d.md",
          line: 1,
          span: [20, 24],
          match: "first",
          note: "deletion",
          ts: "t",
        },
      ],
      unlocated: [{ type: "COMMENT", text: "gone", originalText: "edited away" }],
      globals: ["too terse"],
    });
  });
});

describe("assign", () => {
  test("evidence counts a flag only once assign gives it a pattern", () => {
    const unassigned = flag("a", 1, [1, 5]);
    expect(evidence("p", [], [unassigned]).positives).toEqual([]);
    const assigned = assign("p", [unassigned.id], [], [unassigned], "t2");
    expect(assigned).toEqual({ labels: [], flags: [{ ...unassigned, pattern: "p", ts: "t2" }] });
    const current = latest([unassigned, ...assigned.flags], (f) => f.id);
    expect(evidence("p", [], current).positives).toHaveLength(1);
  });

  test("rejects an id that is neither a label nor a flag", () => {
    expect(() => assign("p", ["nope"], [], [], "t")).toThrow("Unknown ids: nope");
  });
});

function fakeQuery(reply: Reply, prompts: string[]): QueryFn {
  return ({ prompt }) => {
    prompts.push(prompt);
    const messages: Message[] = [{ type: "result", subtype: "success", structured_output: reply }];
    const it = messages[Symbol.iterator]();
    return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(it.next()) }) };
  };
}

describe("propose", () => {
  const lines = ["# Doc", "", "This rule carries real weight here.", "Plain line."];

  test.each<{ name: string; line: number; quote: string; want: string[] }>([
    { name: "a quote on its named line", line: 3, quote: "carries real weight", want: ["3:11-29"] },
    { name: "a quote a line off", line: 4, quote: "carries real weight", want: ["3:11-29"] },
    { name: "a paraphrase", line: 3, quote: "carries weight", want: [] },
    { name: "a quote past the drift", line: 9, quote: "carries real weight", want: [] },
    { name: "an empty quote", line: 3, quote: " ", want: [] },
  ])("resolve keeps $name only when it matches verbatim", ({ line, quote, want }) => {
    const hits = resolve("doc.md", lines, { spans: [{ line, quote, reason: "r" }] });
    expect(hits.map((h) => `${h.line}:${h.span[0]}-${h.span[1]}`)).toEqual(want);
    for (const h of hits) expect(lines[h.line - 1]?.slice(h.span[0] - 1, h.span[1])).toBe(h.match);
  });

  test("spread takes files round-robin across directories", () => {
    const picked = spread(["a/1.md", "a/2.md", "a/3.md", "b/1.md", "c/1.md"], 4);
    expect(
      picked
        .slice(0, 3)
        .map((file) => file.split("/")[0])
        .toSorted((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["a", "b", "c"]);
    expect(picked[3]).toBe("a/2.md");
  });

  test("asks about a file once per text and records its spans as proposals", async () => {
    const root = await mkdtemp(join(tmpdir(), "prose-lab-propose-"));
    await Bun.write(join(root, "doc.md"), lines.join("\n"));
    const prompts: string[] = [];
    const query = fakeQuery(
      { spans: [{ line: 3, quote: "real weight", reason: "figurative" }] },
      prompts,
    );
    const first = await propose({ files: ["doc.md"], existing: [], root, query });
    expect(first[0]?.hits).toMatchObject([
      { check: PROPOSED, message: "figurative", match: "real weight", shipped: false },
    ]);
    expect(await propose({ files: ["doc.md"], existing: first, root, query })).toEqual([]);
    await Bun.write(join(root, "doc.md"), `${lines.join("\n")}\nMore.\n`);
    expect(await propose({ files: ["doc.md"], existing: first, root, query })).toHaveLength(1);
    expect(prompts).toHaveLength(2);
    await rm(root, { recursive: true });
  });

  test("the store merges proposals with the sweep's hits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prose-lab-proposals-"));
    const data = store(dir);
    const swept = hit("a", 1, [1, 2]);
    const proposed = { ...hit("a", 2, [1, 2], PROPOSED), shipped: false };
    await data.writeSweep({ corpus: "all", rev: "r", words: 1, hits: [swept], repos: {} });
    await data.addProposals([{ file: "a", key: "k", asked: 1, hits: [proposed], ts: "t" }]);
    expect((await data.hits()).map((h) => h.check)).toEqual(["Writing.X", PROPOSED]);
    await rm(dir, { recursive: true });
  });
});

describe("repos", () => {
  const text = "# Doc\n\nThe box carries books; the shelf holds them.\n";
  let tmp: string;
  let main: string;
  let org: string;
  let docs: string;

  async function repo(path: string, files: readonly string[]): Promise<string> {
    await Promise.all(files.map((file) => Bun.write(join(path, file), text)));
    await $`git -C ${path} init -q && git -C ${path} add -A && git -C ${path} -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init`;
    return (await $`git -C ${path} rev-parse --show-toplevel`.text()).trim();
  }

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "prose-lab-repos-"));
    const files = ["skills/a/SKILL.md", "README.md"];
    main = await repo(join(tmp, "main"), files);
    org = await repo(join(tmp, "org"), files);
    docs = join(tmp, "docs");
  });
  afterAll(() => rm(tmp, { recursive: true }));

  const Next = z.object({ card: z.object({ file: z.string() }).nullable() });
  /** Every card's file until the deck runs out. */
  async function deal(server: Bun.Server<undefined>, dealt: string[] = []): Promise<string[]> {
    const { card } = Next.parse(await (await fetch(new URL("/api/next", server.url))).json());
    return card === null ? dealt : deal(server, [...dealt, card.file]);
  }

  test("checkouts names a repo by its top-level directory and rejects this repo and a repeated name", async () => {
    expect(await checkouts([join(org, "skills")], main)).toEqual({ org });
    expect(checkouts([main], main)).rejects.toThrow("this repo");
    const twin = await repo(join(tmp, "twin", "org"), ["README.md"]);
    expect(checkouts([org, twin], main)).rejects.toThrow("Two checkouts");
  });

  test("filePath resolves a prefixed file in its checkout and any other file in the root", () => {
    expect(filePath("org:README.md", { org }, main)).toBe(join(org, "README.md"));
    expect(filePath("README.md", { org }, main)).toBe(join(main, "README.md"));
    expect(filePath("other:README.md", { org }, main)).toBe(join(main, "other:README.md"));
  });

  test("a sweep across checkouts keeps the same path in each repo apart, and a corpus narrows it", async () => {
    const swept = await sweep("all", ["writing"], { root: main, docs, repos: { org } });
    expect(swept.repos).toEqual({ org });
    const files = [...new Set(swept.hits.map((h) => h.file))].toSorted();
    expect(files).toEqual([
      "README.md",
      "org:README.md",
      "org:skills/a/SKILL.md",
      "skills/a/SKILL.md",
    ]);
    expect(new Set(swept.hits.map(hitId)).size).toBe(swept.hits.length);
    const prompts = await corpusHits(swept.hits, "agent-facing", {
      root: main,
      docs,
      repos: { org },
    });
    expect([...new Set(prompts.map((h) => h.file))].toSorted()).toEqual([
      "org:skills/a/SKILL.md",
      "skills/a/SKILL.md",
    ]);
  });

  test("serve with a corpus deals and reads documents only from that corpus's files", async () => {
    const data = store(join(tmp, "data"));
    await data.writeSweep(await sweep("all", ["writing"], { root: main, docs, repos: { org } }));
    const { server } = await serve(data, {
      port: 0,
      perCheck: 5,
      root: main,
      docs,
      corpus: "agent-facing",
    });
    try {
      const get = (path: string) => fetch(new URL(path, server.url));
      const doc = await get("/api/doc?file=org:skills/a/SKILL.md");
      expect(z.object({ lines: z.array(z.string()) }).parse(await doc.json()).lines).toEqual(
        text.split("\n"),
      );
      expect((await get("/api/doc?file=org:README.md")).status).toBe(404);
      const dealt = new Set(await deal(server));
      expect([...dealt].every((file) => file.endsWith("SKILL.md"))).toBe(true);
      expect(dealt.size).toBeGreaterThan(0);
    } finally {
      await server.stop(true);
    }
  });

  test("a vote counts one labeled card per card, and a vote on an unknown card fails", async () => {
    const data = store(join(tmp, "votes"));
    await data.writeSweep(await sweep("all", ["writing"], { root: main, docs }));
    const { server } = await serve(data, { port: 0, perCheck: 5, root: main, docs });
    const Voted = z.object({ labeled: z.number(), reveal: z.object({ check: z.string() }) });
    const vote = (id: string) =>
      fetch(new URL("/api/vote", server.url), {
        method: "POST",
        body: JSON.stringify({ id, verdict: "right", note: "" }),
      });
    try {
      const first = z
        .object({ card: z.object({ id: z.string() }), labeled: z.number() })
        .parse(await (await fetch(new URL("/api/next", server.url))).json());
      expect(first.labeled).toBe(0);
      expect(Voted.parse(await (await vote(first.card.id)).json()).labeled).toBe(1);
      expect(Voted.parse(await (await vote(first.card.id)).json()).labeled).toBe(1);
      const missing = await vote("Writing.X|gone.md|1|1");
      expect([missing.status, await missing.text()]).toEqual([404, "unknown hit"]);
    } finally {
      await server.stop(true);
    }
  });

  test("serve skips a saved proposal on a checkout a later sweep dropped", async () => {
    const data = store(join(tmp, "dropped"));
    await data.writeSweep(await sweep("all", ["writing"], { root: main, docs }));
    const stale = { ...hit("gone:README.md", 3, [1, 3], PROPOSED), shipped: false };
    await data.addProposals([
      { file: "gone:README.md", key: "k", asked: 1, hits: [stale], ts: "t" },
    ]);
    await data.enqueue([{ ...stale, pattern: "p", candidate: "c" }]);
    const { server } = await serve(data, { port: 0, perCheck: 5, root: main, docs });
    try {
      expect(await deal(server)).not.toContain("gone:README.md");
    } finally {
      await server.stop(true);
    }
  });

  test("propose reads a prefixed file from its checkout", async () => {
    const query = fakeQuery({ spans: [{ line: 3, quote: "shelf holds", reason: "r" }] }, []);
    const [result] = await propose({
      files: ["org:README.md"],
      existing: [],
      root: main,
      repos: { org },
      query,
    });
    expect(result?.hits).toMatchObject([{ file: "org:README.md", match: "shelf holds" }]);
  });
});
