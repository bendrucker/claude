import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import {
  type Bin,
  binDocuments,
  deltaFromCentroid,
  measure,
  mostFrequentWords,
  quantile,
  renderReport,
  standardize,
  summarizeDeltas,
  wordDrift,
} from "./burrows-delta";
import type { VoiceDocument } from "./voice-corpus";

function makeBin(counts: Record<string, number>): Bin {
  const entries = Object.entries(counts);
  return {
    docs: 1,
    tokens: entries.reduce((sum, [, count]) => sum + count, 0),
    counts: new Map(entries),
  };
}

// One word repeated is the shortest body with a known token count.
function makeDoc(word: string, times: number): VoiceDocument {
  return { source: `${word}-${times}`, meta: "", body: `${word} `.repeat(times).trim() };
}

// Every other bin becomes the standardizing half, so both halves need their own
// spread for the fitted sd to be anything but zero.
const REFERENCE = [4, 5, 6, 4, 4, 6, 6, 5].map((x) => makeBin({ x, y: 10 - x }));

describe("binDocuments", () => {
  test("pools whole documents until the bin reaches the target", () => {
    const bins = binDocuments([makeDoc("alpha", 6), makeDoc("beta", 6)], 10);
    expect(bins).toHaveLength(1);
    expect(bins[0]?.docs).toBe(2);
    expect(bins[0]?.tokens).toBe(12);
    expect(bins[0]?.counts.get("alpha")).toBe(6);
  });

  test("drops a trailing bin that never reaches the target", () => {
    expect(binDocuments([makeDoc("alpha", 10), makeDoc("beta", 3)], 10)).toHaveLength(1);
  });

  test("a document with no prose contributes nothing", () => {
    expect(binDocuments([{ source: "empty", meta: "", body: "" }], 1)).toEqual([]);
  });

  test.each<[string, number]>([
    ["zero", 0],
    ["negative", -5],
    ["fractional", 2.5],
  ])("rejects a %s bin size", (_name, size) => {
    expect(() => binDocuments([], size)).toThrow(/positive integer/);
  });

  test("every emitted bin reaches the target size", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { maxLength: 30 }),
        fc.integer({ min: 1, max: 50 }),
        (lengths, binWords) => {
          const docs = lengths.map((length, index) => makeDoc(`w${index}`, length));
          for (const bin of binDocuments(docs, binWords)) {
            expect(bin.tokens).toBeGreaterThanOrEqual(binWords);
          }
        },
      ),
    );
  });
});

describe("mostFrequentWords", () => {
  const bins = [makeBin({ the: 10, and: 5, rare: 1 }), makeBin({ the: 4, and: 3 })];

  test("ranks by total frequency across bins", () => {
    expect(mostFrequentWords(bins, 3)).toEqual(["the", "and", "rare"]);
  });

  test("keeps only the requested count", () => {
    expect(mostFrequentWords(bins, 1)).toEqual(["the"]);
  });

  test("breaks a frequency tie alphabetically so the word set is deterministic", () => {
    expect(mostFrequentWords([makeBin({ zeta: 3, alpha: 3 })], 2)).toEqual(["alpha", "zeta"]);
  });
});

describe("standardize", () => {
  test("reports the mean and spread of each word's rate across bins", () => {
    // Rates of 1/4 and 3/4: mean 1/2, population sd 1/4.
    const stats = standardize(["x"], [makeBin({ x: 1, y: 3 }), makeBin({ x: 3, y: 1 })]);
    expect(stats.get("x")?.mean).toBeCloseTo(0.5, 10);
    expect(stats.get("x")?.sd).toBeCloseTo(0.25, 10);
  });

  test("a word at one rate everywhere has no spread", () => {
    const stats = standardize(["x"], [makeBin({ x: 1, y: 1 }), makeBin({ x: 2, y: 2 })]);
    expect(stats.get("x")?.sd).toBe(0);
  });

  test("an empty reference standardizes nothing", () => {
    expect(standardize(["x"], []).size).toBe(0);
  });
});

describe("deltaFromCentroid", () => {
  const reference = [makeBin({ x: 1, y: 3 }), makeBin({ x: 3, y: 1 })];
  const stats = standardize(["x"], reference);

  test("a bin sitting at the reference mean is zero distance away", () => {
    expect(deltaFromCentroid(makeBin({ x: 2, y: 2 }), ["x"], stats)).toBeCloseTo(0, 10);
  });

  test("distance is the z-score magnitude, so direction does not cancel", () => {
    expect(deltaFromCentroid(makeBin({ x: 1, y: 3 }), ["x"], stats)).toBeCloseTo(1, 10);
    expect(deltaFromCentroid(makeBin({ x: 3, y: 1 }), ["x"], stats)).toBeCloseTo(1, 10);
  });

  test("a word with no spread in the reference is skipped", () => {
    const flat = standardize(["y"], [makeBin({ y: 1, z: 1 }), makeBin({ y: 2, z: 2 })]);
    expect(deltaFromCentroid(makeBin({ y: 9, z: 1 }), ["y"], flat)).toBe(0);
  });
});

describe("quantile", () => {
  test.each<[string, number, number]>([
    ["median", 0.5, 3],
    ["p95 clamps to the last value", 0.95, 5],
    ["floor", 0, 1],
  ])("%s", (_name, p, expected) => {
    expect(quantile([5, 1, 4, 2, 3], p)).toBe(expected);
  });

  test("an empty sample has no quantile", () => {
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe("summarizeDeltas", () => {
  test("counts the bins and reports the middle and the tail", () => {
    expect(summarizeDeltas([1, 2, 3, 4])).toEqual({ bins: 4, median: 3, p95: 4 });
  });
});

describe("wordDrift", () => {
  const reference = [makeBin({ x: 1, y: 3 }), makeBin({ x: 3, y: 1 })];
  const stats = standardize(["x", "y"], reference);

  test("ranks by distance travelled but keeps the sign", () => {
    const drift = wordDrift([makeBin({ x: 4, y: 0 })], reference, ["x", "y"], stats);
    expect(drift.map((row) => row.word)).toEqual(["x", "y"]);
    expect(drift[0]?.studyZ).toBeGreaterThan(0);
    expect(drift[1]?.studyZ).toBeLessThan(0);
  });

  test("the held-out reference averages to the centroid it defines", () => {
    const drift = wordDrift([makeBin({ x: 2, y: 2 })], reference, ["x"], stats);
    expect(drift[0]?.referenceZ).toBeCloseTo(0, 10);
  });
});

describe("measure", () => {
  test("a study drawn from the reference itself does not clear the floor", () => {
    const result = measure({ name: "study", bins: REFERENCE }, REFERENCE, [], 2);
    expect(result.study.aboveFloor).toBe(0);
  });

  test("a study that sits outside the reference spread clears the floor", () => {
    const result = measure(
      { name: "study", bins: [makeBin({ x: 9, y: 1 }), makeBin({ x: 10, y: 0 })] },
      REFERENCE,
      [],
      2,
    );
    expect(result.study.aboveFloor).toBe(2);
  });

  test("controls are scored against the same centroid as the study", () => {
    const result = measure(
      { name: "study", bins: [makeBin({ x: 9, y: 1 })] },
      REFERENCE,
      [{ name: "control", bins: [makeBin({ x: 5, y: 5 })] }],
      2,
    );
    expect(result.controls.map((row) => [row.name, row.aboveFloor])).toEqual([["control", 0]]);
  });
});

describe("renderReport", () => {
  test("formats the whole measurement", () => {
    const measurement = measure(
      { name: "study", bins: [makeBin({ x: 9, y: 1 })] },
      REFERENCE,
      [{ name: "sent-mail.txt", bins: [makeBin({ x: 7, y: 3 })] }],
      2,
    );
    expect(
      renderReport({
        studyPath: "/data/contrast-baseline/claude-deliverables.txt",
        studyDocs: 559,
        studyTokens: 78_424,
        kinds: ["message"],
        baselineNames: ["github-prs.txt"],
        baselineDocs: 342,
        baselineTokens: 28_411,
        binWords: 1000,
        wordCount: 150,
        measurement,
        show: 2,
      }),
    ).toMatchInlineSnapshot(`
      "corpus A  559 docs, 78,424 tokens  kinds message  /data/contrast-baseline/claude-deliverables.txt
      corpus B  342 docs, 28,411 tokens  github-prs.txt
      bin 1,000 words  words 150  scored over 2 most frequent

      delta from the reference centroid
        held-out reference        4 bins  median 1.000
        study                     1 bins  median 4.000  above floor 1 (100.0%)

      same author, other registers: the distance a register shift alone reaches
        sent-mail.txt             1 bins  median 2.000  above floor 1 (100.0%)

      top 2 words by distance (signed mean z, reference held-out for comparison)
        x                study   +4.00  reference   +0.00
        y                study   -4.00  reference   +0.00"
    `);
  });
});
