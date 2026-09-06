import { describe, expect, test } from "bun:test";
import { fightinWords, rank, stemTerm, tokenizeCorpus } from "./fightin-words";

function counts(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe("fightinWords", () => {
  test("ranks the term concentrated in A above the term split evenly", () => {
    const rows = fightinWords({
      a: counts({ skewed: 200, even: 200 }),
      b: counts({ skewed: 2, even: 200 }),
      totalA: 10_000,
      totalB: 10_000,
      prior: 500,
    });
    expect(rows[0]?.term).toBe("skewed");
    expect(rows[0]?.z).toBeGreaterThan(0);
  });

  test("orders A-heavy terms above B-heavy terms by sign of delta", () => {
    const rows = fightinWords({
      a: counts({ ours: 300, theirs: 5 }),
      b: counts({ ours: 5, theirs: 300 }),
      totalA: 10_000,
      totalB: 10_000,
      prior: 500,
    });
    expect(rows.map((row) => row.term)).toEqual(["ours", "theirs"]);
    expect(rows[0]?.delta).toBeGreaterThan(0);
    expect(rows[1]?.delta).toBeGreaterThan(rows[1]?.z ?? 0);
  });

  // The variance adjustment exists for this case: equal rate ratios, unequal
  // evidence.
  test("a frequent term outranks a rare term at the same rate ratio", () => {
    const rows = fightinWords({
      a: counts({ rare: 3, frequent: 300 }),
      b: counts({ rare: 0, frequent: 0 }),
      totalA: 100_000,
      totalB: 100_000,
      prior: 500,
    });
    const rare = rows.find((row) => row.term === "rare");
    const frequent = rows.find((row) => row.term === "frequent");
    expect(frequent?.z).toBeGreaterThan(rare?.z ?? 0);
  });

  test("a larger prior pulls a rare term further toward the pooled rate", () => {
    const input = {
      a: counts({ rare: 4 }),
      b: counts({ rare: 0 }),
      totalA: 50_000,
      totalB: 50_000,
    };
    const weak = fightinWords({ ...input, prior: 10 })[0];
    const strong = fightinWords({ ...input, prior: 5_000 })[0];
    expect(strong?.delta).toBeLessThan(weak?.delta ?? 0);
  });

  test("a term present in neither corpus never appears", () => {
    const rows = fightinWords({
      a: counts({ present: 5 }),
      b: counts({}),
      totalA: 1_000,
      totalB: 1_000,
      prior: 100,
    });
    expect(rows.map((row) => row.term)).toEqual(["present"]);
  });

  test("empty corpora yield no rows", () => {
    expect(
      fightinWords({ a: counts({}), b: counts({}), totalA: 0, totalB: 0, prior: 500 }),
    ).toEqual([]);
  });

  test("symmetric corpora produce mirrored deltas", () => {
    const forward = fightinWords({
      a: counts({ word: 50 }),
      b: counts({ word: 10 }),
      totalA: 5_000,
      totalB: 5_000,
      prior: 500,
    })[0];
    const reverse = fightinWords({
      a: counts({ word: 10 }),
      b: counts({ word: 50 }),
      totalA: 5_000,
      totalB: 5_000,
      prior: 500,
    })[0];
    expect(forward?.delta).toBeCloseTo(-(reverse?.delta ?? 0), 10);
  });
});

describe("tokenizeCorpus", () => {
  test("counts unigrams and bigrams and keeps the shortest example", () => {
    const corpus = tokenizeCorpus(
      "The load bearing part. This is the load bearing part again.",
      [1, 2],
    );
    expect(corpus.ngrams.get(1)?.get("load")).toBe(2);
    expect(corpus.ngrams.get(2)?.get("load bearing")).toBe(2);
    expect(corpus.examples.get("load bearing")).toBe("The load bearing part");
  });

  test("strips code, paths, and identifiers before counting", () => {
    const corpus = tokenizeCorpus(
      "Consider `someCall()` on src/lib/thing.ts with --dry-run and snake_case names.",
      [1],
    );
    const unigrams = corpus.ngrams.get(1) ?? new Map();
    for (const noise of ["somecall", "src", "ts", "dry", "run", "snake", "case"]) {
      expect(unigrams.has(noise)).toBe(false);
    }
    expect(unigrams.has("names")).toBe(true);
  });

  test("sentences do not bleed n-grams across boundaries", () => {
    const corpus = tokenizeCorpus("First alpha. Beta second.", [2]);
    expect(corpus.ngrams.get(2)?.has("alpha beta")).toBe(false);
  });
});

describe("rank", () => {
  const a = tokenizeCorpus(
    "Worth noting the tradeoff. Worth noting the risk. Worth noting.",
    [1, 2],
  );
  const b = tokenizeCorpus("The tradeoff is fine. The risk is fine. Fine either way.", [1, 2]);

  test("drops terms below the minimum count in A", () => {
    const kept = rank(a, b, { sizes: [1, 2], prior: 100, minCount: 3 });
    expect(kept.every((row) => row.countA >= 3)).toBe(true);
    expect(kept.some((row) => row.term === "worth noting")).toBe(true);
  });

  test("interleaves n-gram sizes into one ordering by z", () => {
    const ranked = rank(a, b, { sizes: [1, 2], prior: 100, minCount: 1 });
    const zs = ranked.map((row) => row.z);
    expect(zs).toEqual(zs.toSorted((left, right) => right - left));
    expect(new Set(ranked.map((row) => row.n))).toEqual(new Set([1, 2]));
  });

  test("carries an example sentence for each ranked term", () => {
    const ranked = rank(a, b, { sizes: [2], prior: 100, minCount: 3 });
    const noting = ranked.find((row) => row.term === "worth noting");
    expect(noting?.example).toContain("Worth noting");
  });
});

describe("stemTerm", () => {
  test.each([
    ["delves", "delv"],
    ["load bearing", "load bear"],
    ["Worth Noting", "worth note"],
  ])("%s stems to %s", (term, expected) => {
    expect(stemTerm(term)).toBe(expected);
  });

  test("an inflected form and its base share a stem", () => {
    expect(stemTerm("leveraged")).toBe(stemTerm("leverage"));
  });
});
