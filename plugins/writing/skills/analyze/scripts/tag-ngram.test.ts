import { describe, expect, it } from "bun:test";
import { processRows } from "./ngram";
import { matchShapes, tagSequence } from "./tag-ngram";

// Invented sentences exercising the structural shapes the signature
// miner exists to catch: passive voice, participial openers, "not X
// but Y" parallelism, and the emphatic negated appositive.
describe("tagSequence", () => {
  it("maps passive voice to COPULA PARTICIPLE", () => {
    const tags = tagSequence("The flag was removed after the rollout").join(" ");
    expect(tags).toBe("DET NOUN COPULA PARTICIPLE ADP DET NOUN");
  });

  it("maps a participial opener to a leading GERUND", () => {
    const tags = tagSequence("Building on the original design, the service keeps one queue");
    expect(tags[0]).toBe("GERUND");
  });

  it("maps not-X-but-Y parallelism through COPULA PART", () => {
    const tags = tagSequence("The fix is not a workaround but a redesign").join(" ");
    expect(tags).toContain("COPULA PART DET NOUN CONJ DET NOUN");
  });

  it("maps the negated appositive pair", () => {
    const tags = tagSequence("This is not a cache, it is a ledger").join(" ");
    expect(tags).toContain("COPULA PART DET NOUN PRON COPULA DET NOUN");
  });

  it("drops punctuation", () => {
    expect(tagSequence("Yes, exactly.")).not.toContain("PUNCT");
  });
});

describe("tag sequences through processRows", () => {
  const passive = "The flag was removed after the rollout";
  const rows = [
    { session_id: "a", text: `${passive}. The flag was removed by the cleanup job.` },
    { session_id: "b", text: "The cache was invalidated by a background sweep." },
    { session_id: "c" },
  ];
  const tokenize = (sentence: string) => tagSequence(sentence);

  it("counts tag trigrams across rows", () => {
    const { stats } = processRows(rows, [3], { tokenize });
    const counts = stats.ngrams.get(3);
    expect(counts?.get("NOUN COPULA PARTICIPLE")).toBe(3);
  });

  it("tracks session spread per sequence", () => {
    const { sessionSpread } = processRows(rows, [3], { tokenize });
    expect(sessionSpread.get("NOUN COPULA PARTICIPLE")).toBe(2);
  });

  it("keeps the shortest example sentence per sequence", () => {
    const examples = new Map<string, string>();
    processRows(rows, [3], { tokenize, examples });
    expect(examples.get("NOUN COPULA PARTICIPLE")).toBe(passive);
  });

  it("skips rows without text", () => {
    const { stats } = processRows([{ session_id: "c" }], [3], { tokenize });
    expect(stats.tokens).toBe(0);
  });
});

// A stub tagger keeps the shapes literal, so the window arithmetic is what the
// assertions read rather than the adapter's judgment about a sentence.
const stubTags: Record<string, string[]> = {
  a: ["DET", "NOUN", "VERB", "DET", "NOUN"],
  b: ["NOUN", "VERB"],
  short: ["NOUN"],
};
const stub = (sentence: string) => stubTags[sentence] ?? [];

describe("matchShapes", () => {
  it("counts every window the sizes offer", () => {
    const match = matchShapes(["a", "b"], [2], new Set(), stub);
    expect(match).toEqual({ hits: 0, total: 5, byShape: [] });
  });

  it("counts windows across several sizes", () => {
    expect(matchShapes(["a"], [2, 3], new Set(), stub).total).toBe(7);
  });

  it("credits a shape once per occurrence", () => {
    const match = matchShapes(["a", "b"], [2], new Set(["NOUN VERB"]), stub);
    expect(match.hits).toBe(2);
    expect(match.byShape).toEqual([{ shape: "NOUN VERB", count: 2 }]);
  });

  it("ranks shapes by count, breaking ties alphabetically", () => {
    const shapes = new Set(["NOUN VERB", "DET NOUN", "VERB DET"]);
    expect(matchShapes(["a"], [2], shapes, stub).byShape).toEqual([
      { shape: "DET NOUN", count: 2 },
      { shape: "NOUN VERB", count: 1 },
      { shape: "VERB DET", count: 1 },
    ]);
  });

  it("offers no windows for a sentence shorter than the size", () => {
    expect(matchShapes(["short"], [2], new Set(["NOUN VERB"]), stub).total).toBe(0);
  });
});
