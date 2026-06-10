import { describe, expect, it } from "bun:test";
import type { CoarseTag } from "./tags";
import { normalizedDistance, tagShape, tricolonHits } from "./tricolon";

const PARALLEL_TRIPLE =
  "The parser validates the incoming request payload quickly. " +
  "The router dispatches the matching handler function cleanly. " +
  "The logger records the final response status faithfully.";

describe("normalizedDistance", () => {
  it("returns 0 for identical sequences", () => {
    const shape: CoarseTag[] = ["NOUN", "VERB", "NOUN"];
    expect(normalizedDistance(shape, shape)).toBe(0);
  });

  it("returns 1 for fully disjoint sequences", () => {
    expect(normalizedDistance(["NOUN", "NOUN"], ["VERB", "ADJ"])).toBe(1);
  });

  it("returns 0 for two empty sequences", () => {
    expect(normalizedDistance([], [])).toBe(0);
  });

  it("normalizes by the longer sequence", () => {
    expect(normalizedDistance(["NOUN", "VERB"], ["NOUN", "VERB", "ADV", "ADV"])).toBe(0.5);
  });
});

describe("tagShape", () => {
  it("filters determiners, punctuation, and numbers", () => {
    const shape = tagShape("The 3 parsers validate the payload.");
    expect(shape).not.toContain("DET");
    expect(shape).not.toContain("NUM");
    expect(shape).not.toContain("PUNCT");
    expect(shape).toContain("VERB");
  });
});

describe("tricolonHits", () => {
  it("flags three consecutive sentences with the same shape", () => {
    const hits = tricolonHits(PARALLEL_TRIPLE);
    expect(hits.count).toBe(1);
    expect(hits.sample).toContain("The parser validates");
  });

  it("finds a triple in the middle of surrounding prose", () => {
    const text = `The deployment finished without incident yesterday afternoon. ${PARALLEL_TRIPLE} Nothing else changed.`;
    expect(tricolonHits(text).count).toBe(1);
  });

  it("ignores texts with fewer than three sentences", () => {
    expect(
      tricolonHits(
        "The parser validates the incoming request payload quickly. The router dispatches the matching handler function cleanly.",
      ).count,
    ).toBe(0);
  });

  it("ignores parallel sentences below the token gate", () => {
    expect(
      tricolonHits("The cache starts cold. The queue fills fast. The worker drains it.").count,
    ).toBe(0);
  });

  it("ignores structurally varied sentences of sufficient length", () => {
    const text =
      "The parser validates the incoming request payload quickly. " +
      "The busy router near the gateway dispatches handlers cleanly under load. " +
      "Because traffic spikes are unpredictable there, operators who watch the dashboards rarely intervene manually.";
    expect(tricolonHits(text).count).toBe(0);
  });

  it("does not flag a drifting sequence whose outer sentences diverge", () => {
    // Adjacent pairs sit under the threshold (0.25, 0.20) while the outer
    // pair lands above it (0.40), so an adjacent-only comparison would flag
    // this. The all-pairwise rule must not.
    const text =
      "The parser validates the incoming request payload quickly. " +
      "The parser validates the incoming request payload quickly during startup. " +
      "Early on, the parser validates the incoming request payload quickly during startup.";
    expect(tricolonHits(text).count).toBe(0);
  });
});
