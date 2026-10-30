import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countWords, lintFiles, PLUGINS } from "./corpus";
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
} from "./score";
import { locate, toFlags } from "./review";
import { context } from "./server";
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
    name: "swap keys and the exceptions list",
    yaml: "swap:\n  'a|b': c\nexceptions:\n  - x\n  - y\n",
    want: { branches: 1, exceptions: 2, tokens: 1 },
  },
])("measure: $name", ({ yaml, want }) => {
  expect(measure(yaml).features).toMatchObject({ unparsed: 0, ...want });
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

test("checkRows marks a check labeled past ten with a floor under the bar", () => {
  const hits = Array.from({ length: 12 }, (_, i) => hit("a", i + 1, [1, 2], "ai-tells.Loud"));
  const labels = hits.map((h, i) => label(h, i < 4 ? "right" : "wrong"));
  expect(checkRows(hits, labels, [])).toMatchObject([
    { check: "ai-tells.Loud", right: 4, wrong: 8, below: true },
  ]);
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
