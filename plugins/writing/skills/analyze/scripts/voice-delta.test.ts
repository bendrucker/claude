import { describe, expect, test } from "bun:test";
import {
  checkRegister,
  computeCorpusRates,
  sentenceSplit,
  VOICE_DELTA_FEATURES,
  type VoiceDeltaFeature,
} from "./voice-delta";

// All rates in this file are computed from invented fixture text. No baseline
// corpus content or baseline-derived numbers appear here.

function feature(id: string): VoiceDeltaFeature {
  const found = VOICE_DELTA_FEATURES.find((f) => f.id === id);
  if (!found) throw new Error(`missing feature: ${id}`);
  return found;
}

describe("VOICE_DELTA_FEATURES", () => {
  test("every feature has a unique id, a provenance label, and a source", () => {
    const ids = VOICE_DELTA_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of VOICE_DELTA_FEATURES) {
      expect(["skill-prescribed", "skill-encouraged", "ungoverned"]).toContain(f.provenance);
      expect(f.source.length).toBeGreaterThan(0);
    }
  });

  test("provenance labels match the #789 spec table", () => {
    const byProvenance = (p: string) =>
      VOICE_DELTA_FEATURES.filter((f) => f.provenance === p)
        .map((f) => f.id)
        .sort();
    expect(byProvenance("skill-encouraged")).toEqual([
      "body_length",
      "causal_language_rate",
      "first_person_rate",
    ]);
    expect(byProvenance("skill-prescribed")).toEqual([
      "action_verb_opener_rate",
      "backtick_density",
      "heading_rate",
      "template_presence",
      "unique_heading_variety",
    ]);
    expect(byProvenance("ungoverned")).toEqual([
      "backtick_manifest_bullet_rate",
      "consequence_chain_rate",
      "median_sentence_length",
      "p90_sentence_length",
      "question_mark_rate",
      "url_rate",
    ]);
  });

  test("sources never embed baseline-vs-AI rate comparisons", () => {
    // Baseline rates live only in the local profile. Skill-text sources may
    // carry forward-looking thresholds but never measured baseline numbers.
    for (const f of VOICE_DELTA_FEATURES) {
      expect(f.source).not.toMatch(/\bvs\.?\b/i);
    }
  });
});

describe("first_person_rate", () => {
  const compute = feature("first_person_rate").compute;

  test("counts I, we, and sentence-initial We per 1k words", () => {
    // 12 words, 3 first-person hits (I, We, we).
    const text = "I tried the cache. We saw it fail. Then we shipped it.";
    expect(compute(text)).toBeCloseTo((3 / 12) * 1000, 5);
  });

  test("ignores lowercase i and code spans", () => {
    expect(compute("The loop uses i as `we` counters here.")).toBe(0);
  });
});

describe("causal_language_rate", () => {
  const compute = feature("causal_language_rate").compute;

  test("counts since and because case-insensitively", () => {
    // 14 words, 2 causal hits.
    const text = "It failed because the lock timed out. Since retries masked it, I removed them.";
    expect(compute(text)).toBeCloseTo((2 / 14) * 1000, 5);
  });
});

describe("body_length", () => {
  const compute = feature("body_length").compute;

  test("counts words excluding code blocks", () => {
    expect(compute("Four words of prose. ```\nconst ignored = true;\n```")).toBe(4);
  });
});

describe("url_rate", () => {
  const compute = feature("url_rate").compute;

  test("counts URLs per 1k words", () => {
    // Stripped text: "See URL for context on the fix." = 7 words, 1 URL.
    const text = "See https://example.com/thread for context on the fix.";
    expect(compute(text)).toBeCloseTo((1 / 7) * 1000, 5);
  });

  test("returns 0 with no URLs", () => {
    expect(compute("No links here at all.")).toBe(0);
  });
});

describe("sentence length features", () => {
  const text = "One two three. One two three four five. One two three four five six seven.";

  test("median over sentence word counts", () => {
    expect(feature("median_sentence_length").compute(text)).toBe(5);
  });

  test("p90 over sentence word counts", () => {
    expect(feature("p90_sentence_length").compute(text)).toBe(7);
  });

  test("both return 0 for empty input", () => {
    expect(feature("median_sentence_length").compute("")).toBe(0);
    expect(feature("p90_sentence_length").compute("")).toBe(0);
  });
});

describe("question_mark_rate", () => {
  test("counts question marks per 1k words", () => {
    // 5 words, 1 question mark.
    const rate = feature("question_mark_rate").compute("Does this hold? It does.");
    expect(rate).toBeCloseTo((1 / 5) * 1000, 5);
  });
});

describe("template_presence", () => {
  const compute = feature("template_presence").compute;

  test("returns 1 when both template sections are present", () => {
    expect(compute("## Changes\n\nStuff.\n\n## Testing\n\nMore.")).toBe(1);
  });

  test("returns 0 when a section is missing", () => {
    expect(compute("## Changes\n\nStuff only.")).toBe(0);
  });
});

describe("unique_heading_variety", () => {
  test("counts unique heading texts case-insensitively", () => {
    const text = "# Title\n\n## Changes\n\n## changes\n\n## Testing\n\nbody";
    expect(feature("unique_heading_variety").compute(text)).toBe(3);
  });
});

describe("heading_rate", () => {
  const compute = feature("heading_rate").compute;

  test("returns 1 with any heading and 0 without", () => {
    expect(compute("## Anything\n\nbody")).toBe(1);
    expect(compute("Plain prose with no headings.")).toBe(0);
  });
});

describe("action_verb_opener_rate", () => {
  test("returns the fraction of lines opening with a present-tense verb", () => {
    const text = "Adds the cache layer.\nThe loader was slow.\nRemoves the old path.\n";
    expect(feature("action_verb_opener_rate").compute(text)).toBeCloseTo(2 / 3, 5);
  });
});

describe("backtick_density", () => {
  test("counts backticks per 1k prose words", () => {
    // Inline code is stripped from the word count: 4 words, 4 backticks.
    const text = "The `cache` and `loader` need work.";
    expect(feature("backtick_density").compute(text)).toBeCloseTo((4 / 4) * 1000, 5);
  });
});

describe("backtick_manifest_bullet_rate", () => {
  test("returns the fraction of bullets in the backtick-colon form", () => {
    const text = "- `foo.ts`: does things\n- a plain bullet\n";
    expect(feature("backtick_manifest_bullet_rate").compute(text)).toBeCloseTo(0.5, 5);
  });

  test("returns 0 with no bullets", () => {
    expect(feature("backtick_manifest_bullet_rate").compute("No bullets here.")).toBe(0);
  });
});

describe("consequence_chain_rate", () => {
  const compute = feature("consequence_chain_rate").compute;

  test("counts comma-so-determiner chains per 1k words", () => {
    // 9 words, 1 chain.
    const text = "The cache was stale, so the loader refetched it.";
    expect(compute(text)).toBeCloseTo((1 / 9) * 1000, 5);
  });

  test("ignores 'so' without a following determiner", () => {
    expect(compute("It ran slowly, so slowly we noticed.")).toBe(0);
  });
});

describe("sentenceSplit", () => {
  test("splits on terminal punctuation and drops empties", () => {
    expect(sentenceSplit("One. Two! Three? ")).toEqual(["One", "Two", "Three"]);
  });
});

describe("checkRegister", () => {
  test("rejects empty input", () => {
    const result = checkRegister("");
    expect(result.inRegister).toBe(false);
    expect(result.reason).toContain("empty");
  });

  test("rejects too-short input", () => {
    const result = checkRegister("One sentence only.");
    expect(result.inRegister).toBe(false);
    expect(result.reason).toContain("too short");
  });

  test("rejects markdown-dominated input", () => {
    const result = checkRegister("#### a. #### b. #### c. ####################");
    expect(result.inRegister).toBe(false);
    expect(result.reason).toContain("markdown fraction");
  });

  test("accepts PR-body-shaped prose", () => {
    const text =
      "This fixes the loader race. I noticed it while testing retries. The fix holds the lock across the read.";
    expect(checkRegister(text)).toEqual({ inRegister: true, reason: null });
  });
});

describe("computeCorpusRates", () => {
  test("averages per-document rates and records the document count", () => {
    const docs = [
      "I fixed the bug today and verified it.", // 8 words, 1 first-person hit
      "The patch landed without any further changes there.", // 8 words, 0 hits
    ];
    const rates = computeCorpusRates(docs);
    const firstPerson = rates.get("first_person_rate");
    expect(firstPerson?.documentCount).toBe(2);
    expect(firstPerson?.rate).toBeCloseTo((1 / 8) * 1000 * 0.5, 5);
  });

  test("returns zero rates for an empty corpus", () => {
    const rates = computeCorpusRates([]);
    for (const f of VOICE_DELTA_FEATURES) {
      expect(rates.get(f.id)?.rate).toBe(0);
      expect(rates.get(f.id)?.documentCount).toBe(0);
    }
  });
});
