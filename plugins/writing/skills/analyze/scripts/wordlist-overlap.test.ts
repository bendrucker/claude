import { describe, expect, test } from "bun:test";
import { rank, type RankedTerm, tokenizeCorpus } from "./fightin-words";
import { splitHalves, type VoiceDocument } from "./voice-corpus";
import {
  coverageOf,
  curatedEntries,
  type MeasuredTerm,
  nullFloorByKind,
  recallOfCuratedEntries,
  renderReport,
  summarize,
} from "./wordlist-overlap";

function makeTerm(overrides: Partial<RankedTerm> = {}): RankedTerm {
  return {
    term: "term",
    countA: 10,
    countB: 1,
    delta: 1,
    z: 2,
    n: 1,
    docs: 4,
    example: "",
    ...overrides,
  };
}

function makeMeasured(coverage: Partial<MeasuredTerm["coverage"]> = {}): MeasuredTerm {
  return {
    row: makeTerm(),
    coverage: { wordlist: false, lexical: false, categories: [], ...coverage },
  };
}

function makeDoc(source: string): VoiceDocument {
  return { source, meta: "", body: `Body of ${source}.` };
}

describe("curatedEntries", () => {
  test.each<{ name: string; plain: string[]; weighted: string[]; expected: string[] }>([
    {
      name: "skips comments and blank lines",
      plain: ["# a comment\n\ndelve\n  tapestry  \n"],
      weighted: [],
      expected: ["delve", "tapestry"],
    },
    {
      name: "strips the trailing weight from a weighted list",
      plain: [],
      weighted: ["empower 2.5\ncleanly 1.5\n"],
      expected: ["empower", "cleanly"],
    },
    {
      name: "keeps a trailing number in a plain list",
      plain: ["web 3\n"],
      weighted: [],
      expected: ["web 3"],
    },
    {
      name: "keeps a multi-word phrase whole",
      plain: ["source of truth\nescape hatch\n"],
      weighted: [],
      expected: ["source of truth", "escape hatch"],
    },
    {
      name: "concatenates every source list",
      plain: ["delve\n"],
      weighted: ["empower 2.5\n"],
      expected: ["delve", "empower"],
    },
  ])("$name", ({ plain, weighted, expected }) => {
    expect(curatedEntries(plain, weighted)).toEqual(expected);
  });
});

describe("coverageOf", () => {
  test("a curated vocabulary entry is reported as wordlist-covered", () => {
    expect(coverageOf("delve", "").wordlist).toBe(true);
  });

  test("an inflected form of a curated entry still matches", () => {
    expect(coverageOf("meticulously", "").wordlist).toBe(true);
  });

  test("an ordinary function word matches nothing", () => {
    const coverage = coverageOf("the", "The change is in the parser.");
    expect(coverage.wordlist).toBe(false);
    expect(coverage.lexical).toBe(false);
  });

  test("a sentence tripping a detector reports its category", () => {
    expect(coverageOf("dig", "Let me dig into the failing test.").categories).toContain("dig into");
  });

  // The hook skips skillOnly patterns; this batch surface exists to audit them.
  test("a skill-only detector still counts as coverage", () => {
    expect(coverageOf("rides", "The retry path rides on the same socket.").categories).toContain(
      "rides on",
    );
  });

  test("an empty example cannot trip a sentence-level detector", () => {
    expect(coverageOf("the", "").categories).toEqual([]);
  });
});

describe("summarize", () => {
  test("counts each coverage kind independently", () => {
    expect(
      summarize([
        makeMeasured({ wordlist: true, lexical: true, categories: ["a"] }),
        makeMeasured({ lexical: true, categories: ["a"] }),
        makeMeasured({ categories: ["a"] }),
        makeMeasured(),
      ]),
    ).toEqual({ considered: 4, wordlist: 1, lexical: 2, sentence: 3 });
  });

  test("an empty measurement is all zeroes", () => {
    expect(summarize([])).toEqual({ considered: 0, wordlist: 0, lexical: 0, sentence: 0 });
  });
});

describe("recallOfCuratedEntries", () => {
  const ranked = [
    makeTerm({ term: "delves", z: 5 }),
    makeTerm({ term: "robust", z: 3 }),
    makeTerm({ term: "ordinary", z: 1 }),
  ];

  test("finds a curated entry through its stem", () => {
    expect(recallOfCuratedEntries(["delve"], ranked, 3)[0]).toEqual({
      entry: "delve",
      rankIndex: 0,
      z: 5,
    });
  });

  test("reports an entry outside the cutoff as unplaced but keeps its score", () => {
    expect(recallOfCuratedEntries(["robust"], ranked, 1)[0]).toEqual({
      entry: "robust",
      rankIndex: null,
      z: 3,
    });
  });

  test("an entry absent from the ranking carries no score", () => {
    expect(recallOfCuratedEntries(["tapestry"], ranked, 3)[0]).toEqual({
      entry: "tapestry",
      rankIndex: null,
      z: null,
    });
  });

  test("keeps the highest-ranked occurrence when a stem repeats", () => {
    const repeated = [makeTerm({ term: "delve", z: 9 }), makeTerm({ term: "delves", z: 2 })];
    expect(recallOfCuratedEntries(["delving"], repeated, 2)[0]?.z).toBe(9);
  });
});

describe("null control", () => {
  test("a homogeneous corpus contrasted with itself stays near zero", () => {
    const docs = Array.from({ length: 200 }, (_, index) => ({
      source: `doc-${index}`,
      meta: "",
      body: "The parser reads the file and returns the tree.",
    }));
    const [left, right] = splitHalves(docs);
    const ranked = rank(tokenizeCorpus(left, [1]), tokenizeCorpus(right, [1]), {
      sizes: [1],
      prior: 500,
      minCount: 1,
      minDocs: 1,
    });
    expect(Math.abs(ranked[0]?.z ?? 0)).toBeLessThan(0.5);
  });
});

describe("nullFloorByKind", () => {
  const options = { sizes: [1], prior: 500, minCount: 1, minDocs: 1 };

  // One body across every document, so any score the split produces is noise.
  function sameBody(source: string): VoiceDocument {
    return { source, meta: "", body: "The parser reads the file and returns the tree." };
  }

  test("scores each kind present against itself, in kind order", () => {
    const docs = [
      ...Array.from({ length: 6 }, (_, index) => sameBody(`session-${index}`)),
      ...Array.from({ length: 4 }, (_, index) => sameBody(`/repo/doc-${index}.md`)),
    ];
    const floors = nullFloorByKind(docs, options);
    expect(floors.map((floor) => [floor.kind, floor.docs])).toEqual([
      ["message", 6],
      ["docs", 4],
    ]);
    for (const floor of floors) expect(Math.abs(floor.maxZ ?? 0)).toBeLessThan(0.5);
  });

  test("a kind holding one document has no split to score", () => {
    expect(nullFloorByKind([makeDoc("/repo/only.md")], options)).toEqual([
      { kind: "docs", docs: 1, maxZ: null },
    ]);
  });
});

describe("renderReport", () => {
  test("formats the whole measurement", () => {
    expect(
      renderReport({
        study: {
          path: "/data/contrast-baseline/claude-deliverables.txt",
          kinds: ["docs", "other"],
          docs: 22,
          tokens: 1234,
        },
        baseline: { names: ["github-prs.txt"], docs: 342, tokens: 5678 },
        kindFloors: [
          { kind: "docs", docs: 18, maxZ: 6.31 },
          { kind: "other", docs: 4, maxZ: null },
        ],
        prior: 500,
        sizes: [1, 2],
        minCount: 5,
        minDocs: 3,
        summary: { considered: 2, wordlist: 0, lexical: 1, sentence: 1 },
        nullTop: [makeTerm({ term: "noise", z: 4.29 })],
        recall: [
          { entry: "delve", rankIndex: 12, z: 3.5 },
          { entry: "tapestry", rankIndex: null, z: null },
        ],
        curatedPool: 140_000,
        measured: [
          {
            row: makeTerm({ term: "worth noting", z: 12.3, countA: 40, countB: 2, docs: 18 }),
            coverage: { wordlist: false, lexical: true, categories: ["hedging"] },
          },
          {
            row: makeTerm({ term: "the", z: 1.1 }),
            coverage: { wordlist: false, lexical: false, categories: [] },
          },
        ],
        show: 2,
      }),
    ).toMatchInlineSnapshot(`
      "corpus A  22 docs, 1,234 tokens  kinds docs,other  /data/contrast-baseline/claude-deliverables.txt
      corpus B  342 docs, 5,678 tokens  github-prs.txt
      prior 500  sizes 1,2  min-count 5  min-docs 3

      top 2 discovered terms
        matched by a curated wordlist entry     0 (0.0%)
        matched by any vocabulary-layer rule    1 (50.0%)
        example sentence trips any rule at all  1 (50.0%)

      null control (corpus A split in half): max z=4.29, top terms noise

      null floor by kind (each kind split against itself)
        docs        18 docs  max z=6.31
        other        4 docs  max z=n/a

      curated entries, ranked over 140,000 terms at min-count 1
        delve                #13  z=3.50
        tapestry             absent from corpus A

      top 2 by z
        1. -LS  z=  12.3  40/2 in 18 docs  worth noting
        2. ---  z=   1.1  10/1 in 4 docs  the"
    `);
  });
});
