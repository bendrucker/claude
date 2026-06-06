import { describe, expect, it } from "bun:test";
import { processPosRows, tagSequence } from "./pos-ngram";

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

describe("processPosRows", () => {
  const passive = "The flag was removed after the rollout";
  const rows = [
    { session_id: "a", text: `${passive}. The flag was removed by the cleanup job.` },
    { session_id: "b", text: "The cache was invalidated by a background sweep." },
    { session_id: "c" },
  ];

  it("counts tag trigrams across rows", () => {
    const { stats } = processPosRows(rows, [3]);
    const counts = stats.ngrams.get(3);
    expect(counts?.get("NOUN COPULA PARTICIPLE")).toBe(3);
  });

  it("tracks session spread per sequence", () => {
    const { sessionSpread } = processPosRows(rows, [3]);
    expect(sessionSpread.get("NOUN COPULA PARTICIPLE")).toBe(2);
  });

  it("keeps the shortest example sentence per sequence", () => {
    const { examples } = processPosRows(rows, [3]);
    expect(examples.get("NOUN COPULA PARTICIPLE")).toBe(passive);
  });

  it("skips rows without text", () => {
    const { stats } = processPosRows([{ session_id: "c" }], [3]);
    expect(stats.tokens).toBe(0);
  });
});
