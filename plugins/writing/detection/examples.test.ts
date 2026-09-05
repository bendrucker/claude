import { describe, expect, it } from "bun:test";
import { BATCH_PATTERNS } from "./scan";
import { PATTERNS, type PatternDef } from "./tropes";

// Regression gate for the examples embedded in every PatternDef. Each pattern
// carries invented positives (must match) and negatives (must not match), so a
// pattern edit that breaks its own examples fails here deterministically. This
// generalizes the linguistics/fixtures.ts approach from headings to every rule.
// Batch-only patterns (tagger-backed, never hook-loaded) face the same gate.

const ALL_PATTERNS: PatternDef[] = [...PATTERNS, ...BATCH_PATTERNS];

function hits(def: PatternDef, text: string): number {
  if (typeof def.test === "function") {
    return def.test(text).count;
  }
  def.test.lastIndex = 0;
  return text.match(def.test)?.length ?? 0;
}

describe("pattern examples", () => {
  describe.each(ALL_PATTERNS)("$category", (def) => {
    it("has at least 2 positives and 2 negatives", () => {
      expect(def.positives.length).toBeGreaterThanOrEqual(2);
      expect(def.negatives.length).toBeGreaterThanOrEqual(2);
    });

    it.each(def.positives)("matches: %s", (positive) => {
      expect(hits(def, positive)).toBeGreaterThan(0);
    });

    it.each(def.negatives)("does not match: %s", (negative) => {
      expect(hits(def, negative)).toBe(0);
    });
  });

  it("labels every pattern with a layer", () => {
    for (const def of ALL_PATTERNS) {
      expect(["vocabulary", "grammar", "cross-sentence", "meaning"]).toContain(def.layer);
    }
  });

  it("records evidence and a retirement condition for every pattern", () => {
    for (const def of ALL_PATTERNS) {
      expect(def.evidence.length).toBeGreaterThan(0);
      expect(def.retire.length).toBeGreaterThan(0);
    }
  });
});
