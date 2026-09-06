import { describe, expect, test } from "bun:test";
import { rank, type RankedTerm, tokenizeCorpus } from "./fightin-words";
import type { VoiceDocument } from "./voice-corpus";
import {
  coverageOf,
  curatedEntries,
  type MeasuredTerm,
  recallOfCuratedEntries,
  splitHalves,
  summarize,
} from "./wordlist-overlap";

function makeTerm(overrides: Partial<RankedTerm> = {}): RankedTerm {
  return { term: "term", countA: 10, countB: 1, delta: 1, z: 2, n: 1, example: "", ...overrides };
}

function makeMeasured(coverage: Partial<MeasuredTerm["coverage"]> = {}): MeasuredTerm {
  return {
    row: makeTerm(),
    coverage: { wordlist: false, lexical: false, sentence: false, categories: [], ...coverage },
  };
}

function makeDoc(source: string): VoiceDocument {
  return { source, meta: "", body: `Body of ${source}.` };
}

describe("curatedEntries", () => {
  test("skips comments and blank lines", () => {
    expect(curatedEntries(["# a comment\n\ndelve\n  tapestry  \n"])).toEqual(["delve", "tapestry"]);
  });

  test("strips the trailing weight from a weighted list", () => {
    expect(curatedEntries(["empower 2.5\ncleanly 1.5\n"])).toEqual(["empower", "cleanly"]);
  });

  test("keeps a multi-word phrase whole", () => {
    expect(curatedEntries(["source of truth\nescape hatch\n"])).toEqual([
      "source of truth",
      "escape hatch",
    ]);
  });

  test("concatenates every source list", () => {
    expect(curatedEntries(["delve\n", "empower 2.5\n"])).toEqual(["delve", "empower"]);
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
    const coverage = coverageOf("dig", "Let me dig into the failing test.");
    expect(coverage.sentence).toBe(true);
    expect(coverage.categories).toContain("dig into");
  });

  test("an empty example cannot trip a sentence-level detector", () => {
    expect(coverageOf("the", "").sentence).toBe(false);
  });
});

describe("summarize", () => {
  test("counts each coverage kind independently", () => {
    const summary = summarize([
      makeMeasured({ wordlist: true, lexical: true, sentence: true }),
      makeMeasured({ lexical: true, sentence: true }),
      makeMeasured({ sentence: true }),
      makeMeasured(),
    ]);
    expect(summary).toEqual({ considered: 4, wordlist: 1, lexical: 2, sentence: 3 });
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
    const [found] = recallOfCuratedEntries(["delve"], ranked, 3);
    expect(found).toEqual({ entry: "delve", rankIndex: 0, z: 5 });
  });

  test("reports an entry outside the cutoff as unplaced but keeps its score", () => {
    const [found] = recallOfCuratedEntries(["robust"], ranked, 1);
    expect(found).toEqual({ entry: "robust", rankIndex: null, z: 3 });
  });

  test("an entry absent from the ranking carries no score", () => {
    const [found] = recallOfCuratedEntries(["tapestry"], ranked, 3);
    expect(found).toEqual({ entry: "tapestry", rankIndex: null, z: null });
  });

  test("keeps the highest-ranked occurrence when a stem repeats", () => {
    const repeated = [makeTerm({ term: "delve", z: 9 }), makeTerm({ term: "delves", z: 2 })];
    expect(recallOfCuratedEntries(["delving"], repeated, 2)[0]?.z).toBe(9);
  });
});

describe("splitHalves", () => {
  test("alternates documents so both halves span the corpus", () => {
    const [left, right] = splitHalves(["a", "b", "c", "d", "e"].map(makeDoc));
    expect(left.map((doc) => doc.source)).toEqual(["a", "c", "e"]);
    expect(right.map((doc) => doc.source)).toEqual(["b", "d"]);
  });

  test("an empty corpus splits into two empty halves", () => {
    expect(splitHalves([])).toEqual([[], []]);
  });

  test("a homogeneous corpus contrasted with itself stays near zero", () => {
    const docs = Array.from({ length: 200 }, (_, index) => ({
      source: `doc-${index}`,
      meta: "",
      body: "The parser reads the file and returns the tree.",
    }));
    const [left, right] = splitHalves(docs);
    const ranked = rank(
      tokenizeCorpus(left.map((doc) => doc.body).join("\n\n"), [1]),
      tokenizeCorpus(right.map((doc) => doc.body).join("\n\n"), [1]),
      { sizes: [1], prior: 500, minCount: 1 },
    );
    expect(Math.abs(ranked[0]?.z ?? 0)).toBeLessThan(0.5);
  });
});
