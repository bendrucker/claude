import { describe, expect, it } from "bun:test";
import { rank, type RankedTerm, tokenizeCorpus } from "./fightin-words";
import {
  aboveFloor,
  cachingTagger,
  nullFloor,
  renderReport,
  type SizeFloor,
} from "./tag-signatures";
import type { VoiceDocument } from "./voice-corpus";

function doc(source: string, body: string): VoiceDocument {
  return { source, meta: "", body };
}

function messages(count: number, body: string): VoiceDocument[] {
  return Array.from({ length: count }, (_, index) => doc(`session-${index}`, body));
}

const OPTIONS = { sizes: [2], prior: 500, minCount: 1, minDocs: 1 };

describe("cachingTagger", () => {
  it("tags each distinct sentence once", () => {
    const seen: string[] = [];
    const tagger = cachingTagger((sentence) => {
      seen.push(sentence);
      return sentence.split(" ");
    });

    expect(tagger("one two")).toEqual(["one", "two"]);
    expect(tagger("one two")).toEqual(["one", "two"]);
    expect(tagger("three four")).toEqual(["three", "four"]);

    expect(seen).toEqual(["one two", "three four"]);
  });

  it("caches an empty tag list rather than re-tagging it", () => {
    let calls = 0;
    const tagger = cachingTagger(() => {
      calls += 1;
      return [];
    });
    tagger("silent");
    tagger("silent");
    expect(calls).toBe(1);
  });
});

const words = (sentence: string): string[] => sentence.split(/\s+/).filter((w) => w.length > 0);

// splitHalves alternates by index, so even and odd bodies land in opposite
// halves and the split has a difference to find.
function kinded(prefix: string): VoiceDocument[] {
  return Array.from({ length: 4 }, (_, index) =>
    doc(
      `${prefix}-${index}`,
      index % 2 === 0 ? `${prefix} alpha beta alpha.` : `${prefix} gamma delta gamma.`,
    ),
  );
}

describe("nullFloor", () => {
  it("scores a floor per n-gram size", () => {
    const floor = nullFloor(
      messages(6, "alpha beta gamma delta."),
      { ...OPTIONS, sizes: [2, 3] },
      words,
    );
    expect(floor.has(2)).toBe(true);
    expect(floor.has(3)).toBe(true);
  });

  it("leaves a single document unsplit and so unfloored", () => {
    expect(nullFloor([doc("only", "alpha beta.")], OPTIONS, words)).toEqual(new Map());
  });

  it("splits the pooled corpus, so a second kind moves the floor", () => {
    // The ranking pools every selected kind. A floor taken per kind and maxed
    // bounds no single population, so the split has to see the same documents
    // the ranking does.
    const messageDocs = kinded("session");
    const scratchDocs = kinded("tmp/scratch");
    const alone = nullFloor(messageDocs, OPTIONS, words).get(2);
    const pooled = nullFloor([...messageDocs, ...scratchDocs], OPTIONS, words).get(2);
    expect(pooled).not.toBe(alone);
    expect(pooled).not.toBe(nullFloor(scratchDocs, OPTIONS, words).get(2));
  });

  it("floors a corpus whose halves differ above one whose halves match", () => {
    // splitHalves alternates by index, so even and odd bodies land in opposite
    // halves and the split has a real difference to find.
    const identical = nullFloor(messages(8, "alpha beta gamma."), OPTIONS, words).get(2) ?? 0;
    const contrasted =
      nullFloor(
        Array.from({ length: 8 }, (_, index) =>
          doc(
            `session-${index}`,
            index % 2 === 0 ? "alpha beta alpha beta." : "gamma delta gamma.",
          ),
        ),
        OPTIONS,
        words,
      ).get(2) ?? 0;
    expect(contrasted).toBeGreaterThan(identical);
  });
});

function ranked(z: number, n = 3, term = "DET NOUN VERB"): RankedTerm {
  return { term, countA: 10, countB: 1, delta: z / 2, z, n, docs: 5, example: "" };
}

describe("aboveFloor", () => {
  const floor: SizeFloor = new Map([[3, 4]]);

  it("keeps a shape scoring above its floor", () => {
    expect(aboveFloor([ranked(6)], floor).map(({ row }) => row.z)).toEqual([6]);
  });

  it("drops a shape at or below its floor", () => {
    expect(aboveFloor([ranked(4), ranked(2)], floor)).toEqual([]);
  });

  it("keeps an unfloored size and records the floor as null", () => {
    const kept = aboveFloor([ranked(1, 5)], floor);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.floor).toBeNull();
  });

  it("gates each size against its own floor", () => {
    const twoSizes: SizeFloor = new Map([
      [3, 10],
      [4, 1],
    ]);
    const kept = aboveFloor([ranked(5, 3), ranked(5, 4)], twoSizes);
    expect(kept.map(({ row }) => row.n)).toEqual([4]);
  });
});

describe("renderReport", () => {
  const report = {
    study: { path: "/corpus/a.txt", kinds: ["message" as const], docs: 9, tokens: 1200 },
    baseline: { names: ["github-prs.txt"], docs: 4, tokens: 800 },
    floor: new Map([
      [3, 3.25],
      [4, 1.5],
    ]),
    splitDocs: 9,
    sizes: [3, 4],
    prior: 500,
    minCount: 30,
    minDocs: 3,
    ranked: 12,
    signatures: [{ row: ranked(7.75, 3), floor: 3.25 }],
    show: 40,
  };

  it("prints each shape's score beside the floor it cleared", () => {
    expect(renderReport(report)).toContain("z=   7.8  floor=  3.3");
  });

  it("prints a floor per size and the size of the split behind it", () => {
    expect(renderReport(report)).toContain("3-gram 3.3  4-gram 1.5");
    expect(renderReport(report)).toContain("corpus A split against itself, 9 docs");
  });

  it("marks a size the corpus could not floor", () => {
    const unfloored = { ...report, sizes: [3, 4, 5] };
    expect(renderReport(unfloored)).toContain("5-gram n/a");
  });

  it("says how many shapes survived the floor", () => {
    expect(renderReport(report)).toContain("1 of 12 shapes clear their floor");
  });

  it("prints an example sentence under a shape that carries one", () => {
    const withExample = {
      ...report,
      signatures: [{ row: { ...ranked(7.75, 3), example: "The flag was removed" }, floor: 3.25 }],
    };
    expect(renderReport(withExample)).toContain("     The flag was removed");
  });
});

describe("ranking tag sequences end to end", () => {
  it("ranks a shape the study corpus repeats and the baseline does not", () => {
    const study = messages(6, "The flag was removed. The cache was invalidated.");
    const baseline = [doc("pr-1", "We removed the flag. I invalidated the cache.")];
    const tokenize = cachingTagger();
    const rows = rank(
      tokenizeCorpus(study, [3], tokenize),
      tokenizeCorpus(baseline, [3], tokenize),
      { sizes: [3], prior: 500, minCount: 2, minDocs: 2 },
    );
    expect(rows.map((row) => row.term)).toContain("NOUN COPULA PARTICIPLE");
  });
});
