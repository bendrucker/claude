import { describe, expect, test } from "bun:test";
import {
  checkRegister,
  computeCorpusRates,
  RETIRED_FEATURES,
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
        .toSorted();
    expect(byProvenance("skill-encouraged")).toEqual(["body_length", "first_person_rate"]);
    expect(byProvenance("skill-prescribed")).toEqual([
      "action_verb_opener_rate",
      "backtick_density",
      "heading_rate",
      "negation_rate",
      "no_negation_share",
      "template_presence",
      "unique_heading_variety",
    ]);
    expect(byProvenance("ungoverned")).toEqual([
      "backtick_manifest_bullet_rate",
      "consequence_chain_rate",
      "discourse_marker_rate",
      "median_sentence_length",
      "negative_contrast_rate",
      "subordinate_coordinate_ratio",
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

describe("RETIRED_FEATURES", () => {
  test("stays disjoint from the live set, so a retired candidate reaches no profile", () => {
    const live = new Set(VOICE_DELTA_FEATURES.map((f) => f.id));
    for (const f of RETIRED_FEATURES) expect(live.has(f.id)).toBe(false);
  });

  test("carries the same shape as a live feature, so the null can score it", () => {
    const ids = RETIRED_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of RETIRED_FEATURES) {
      expect(["skill-prescribed", "skill-encouraged", "ungoverned"]).toContain(f.provenance);
      expect(f.source.length).toBeGreaterThan(0);
      expect(Number.isFinite(f.compute("One sentence. Another sentence."))).toBe(true);
    }
  });
});

function retired(id: string): VoiceDeltaFeature {
  const found = RETIRED_FEATURES.find((f) => f.id === id);
  if (!found) throw new Error(`missing retired feature: ${id}`);
  return found;
}

describe("paragraph_length_uniformity", () => {
  const compute = retired("paragraph_length_uniformity").compute;

  test("scores 1 when every paragraph is the same length", () => {
    expect(compute("one two three.\n\nfour five six.")).toBe(1);
  });

  test("ignores headings, which are not prose paragraphs", () => {
    const even = "one two three.\n\nfour five six.";
    expect(compute(`# Title\n\n${even}\n\n## Section`)).toBe(compute(even));
  });

  test("ignores list items", () => {
    const even = "one two three.\n\nfour five six.";
    expect(compute(`${even}\n\n- a\n- b c d e f g h`)).toBe(compute(even));
  });

  test("returns 0 with fewer than two paragraphs", () => {
    expect(compute("# Title\n\n- only a bullet")).toBe(0);
  });
});

describe("parallel_construction_rate", () => {
  const compute = retired("parallel_construction_rate").compute;

  test("counts an ordered list, which a bullet pattern misses", () => {
    expect(compute("1. the parser returns a row\n2. the parser returns a page")).toBe(1);
  });

  test("counts a nested item as its own unit", () => {
    const text = "- the parser returns a row\n  - the parser returns a page";
    expect(compute(text)).toBe(1);
  });

  test("scores 0 when adjacent units open differently", () => {
    expect(compute("- the parser returns a row\n- a router drops the page")).toBe(0);
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

describe("median_sentence_length", () => {
  const compute = feature("median_sentence_length").compute;

  test("median over sentence word counts", () => {
    expect(
      compute("One two three. One two three four five. One two three four five six seven."),
    ).toBe(5);
  });

  test("returns 0 for empty input", () => {
    expect(compute("")).toBe(0);
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

  test("requires a word boundary after the section name", () => {
    expect(compute("## Changeset\n\nStuff.\n\n## Testing\n\nMore.")).toBe(0);
  });

  test("ignores headings inside fenced code blocks", () => {
    expect(compute("Prose.\n\n```md\n## Changes\n## Testing\n```")).toBe(0);
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

  test("does not count shell comments in fenced code as headings", () => {
    expect(compute("Run the script.\n\n```sh\n# this is a comment\nrun.sh\n```")).toBe(0);
  });
});

describe("action_verb_opener_rate", () => {
  const compute = feature("action_verb_opener_rate").compute;

  test("returns the fraction of lines opening with a present-tense verb", () => {
    const text = "Adds the cache layer.\nThe loader was slow.\nRemoves the old path.\n";
    expect(compute(text)).toBeCloseTo(2 / 3, 5);
  });

  test("counts bullet lines, where the pattern stacks", () => {
    const text = "- Adds the cache layer\n- Removes the old path\n";
    expect(compute(text)).toBe(1);
  });

  test("excludes fenced code lines from the denominator", () => {
    const text = "Adds the cache layer.\n\n```\nx = 1\ny = 2\nz = 3\n```\n";
    expect(compute(text)).toBe(1);
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

describe("subordinate_coordinate_ratio", () => {
  const compute = feature("subordinate_coordinate_ratio").compute;

  test("divides subordinators by coordinators", () => {
    // 2 subordinators (because, which), 1 coordinator (and).
    const text =
      "The loader retried because the cache was cold and returned the row, which was stale.";
    expect(compute(text)).toBeCloseTo(2, 5);
  });

  test("returns 0 when no coordinator is present", () => {
    expect(compute("The loader retried because the cache was cold.")).toBe(0);
  });

  test("ignores clause words inside code spans", () => {
    expect(
      compute("Call `if (a and b)` twice. The row loads because it is warm and cached."),
    ).toBeCloseTo(1, 5);
  });
});

describe("negative_contrast_rate", () => {
  const compute = feature("negative_contrast_rate").compute;

  test("counts rather than, instead of, and never per 1k words", () => {
    // 12 words, 2 constructions.
    const text = "It retries rather than failing, and it never drops instead of queueing.";
    const words = text.split(/\s+/).length;
    expect(compute(text)).toBeGreaterThan((2 / words) * 1000 * 0.9);
  });

  test("returns 0 on prose without contrast constructions", () => {
    expect(compute("The loader refetches the row and writes it to the cache.")).toBe(0);
  });
});

describe("no_negation_share", () => {
  const compute = feature("no_negation_share").compute;

  test("scores near 1 on a no-form paragraph", () => {
    const text =
      "The wrapper adds nothing to the default path. The audit found no defects. The retry holds no lock.";
    expect(compute(text)).toBe(1);
  });

  test("scores near 0 on a not-form paragraph", () => {
    const text =
      "The wrapper doesn't add anything to the default path. The audit did not find any defects. The retry does not hold either lock.";
    expect(compute(text)).toBe(0);
  });

  test("scores 0 on predication the baseline writes in the no-form", () => {
    const text = "The build has no tests. There is no lock on the guard.";
    expect(compute(text)).toBe(0);
  });
});

describe("negation_rate", () => {
  const compute = feature("negation_rate").compute;

  test("counts both forms per 1k words", () => {
    const text =
      "The wrapper adds nothing, and the audit doesn't find anything worth a second run.";
    const words = text.split(/\s+/).length;
    expect(compute(text)).toBeCloseTo((2 / words) * 1000, 5);
  });

  test("scores 0 on a positive-frame rewrite", () => {
    const text = "The wrapper is a no-op on the default path. The guard stays unchanged.";
    expect(compute(text)).toBe(0);
  });
});

describe("discourse_marker_rate", () => {
  const compute = feature("discourse_marker_rate").compute;

  test("counts single-word connectives per 1k words", () => {
    // 9 words, 1 marker.
    const text = "The cache was cold. However, the loader retried it.";
    expect(compute(text)).toBeCloseTo((1 / 9) * 1000, 5);
  });

  test("counts a multi-word connective as a single marker", () => {
    // The four words of "on the other hand" contribute one match.
    const text = "It retries. On the other hand, it drops the row.";
    const words = 10;
    expect(compute(text)).toBeCloseTo((1 / words) * 1000, 5);
  });

  test("ignores markers inside code spans", () => {
    expect(compute("Call `however(x)` and `thus(y)` from the handler.")).toBe(0);
  });

  test("returns 0 on prose with no connectives", () => {
    expect(compute("The loader refetches the row and writes it back.")).toBe(0);
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
