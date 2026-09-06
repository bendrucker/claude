import { describe, expect, it } from "bun:test";
import {
  compilePlainWordlist,
  compileStemmedPhrases,
  compileStemmedWordlist,
  compileWeightedStems,
  stemmedPhraseHits,
  WORDLISTS,
  weightedStemHits,
} from "./wordlists";

describe("compilePlainWordlist", () => {
  it("returns null for empty content", () => {
    expect(compilePlainWordlist("")).toBeNull();
  });

  it("returns null for comments-only content", () => {
    expect(compilePlainWordlist("# only comments\n# nothing else\n")).toBeNull();
  });

  it("ignores comments and blank lines", () => {
    const re = compilePlainWordlist("# header\n\nfoo\n\n# trailing\nbar\n");
    if (re === null) throw new Error("expected regex");
    expect("the foo here".match(re)?.[0]).toBe("foo");
    expect("the bar here".match(re)?.[0]).toBe("bar");
  });

  it("dedupes entries", () => {
    const re = compilePlainWordlist("foo\nfoo\n");
    expect(re?.source).toBe(String.raw`\b(?:foo)\b`);
  });

  it("honors prefix/suffix/flags overrides", () => {
    const re = compilePlainWordlist("foo\nbar\n", {
      prefix: "^",
      suffix: "$",
      flags: "im",
    });
    if (re === null) throw new Error("expected regex");
    expect(re.flags).toBe("im");
    expect("FOO".match(re)?.[0]).toBe("FOO");
    expect("a foo".match(re)).toBeNull();
  });
});

describe("compileStemmedWordlist", () => {
  it("matches base word", () => {
    const matcher = compileStemmedWordlist("delve\n");
    expect(matcher("we delve into the data").count).toBeGreaterThan(0);
  });

  it("matches inflected forms via stemming", () => {
    const matcher = compileStemmedWordlist("meticulous\n");
    expect(matcher("done meticulously").count).toBeGreaterThan(0);
    expect(matcher("a meticulous review").count).toBeGreaterThan(0);
  });

  it("matches garnered from garner", () => {
    const matcher = compileStemmedWordlist("garner\n");
    expect(matcher("the project garnered attention").count).toBeGreaterThan(0);
  });

  it("returns sample of original word from text", () => {
    const matcher = compileStemmedWordlist("foster\n");
    const result = matcher("by fostering collaboration");
    expect(result.count).toBe(1);
    expect(result.sample).toBe("fostering");
  });

  it("does not match unrelated words", () => {
    const matcher = compileStemmedWordlist("delve\n");
    expect(matcher("the function processes input").count).toBe(0);
  });

  it("ignores comments and blank lines", () => {
    const matcher = compileStemmedWordlist("# header\n\ndelve\n");
    expect(matcher("we delve into it").count).toBeGreaterThan(0);
  });

  it("counts multiple occurrences", () => {
    const matcher = compileStemmedWordlist("foster\n");
    expect(matcher("fostering growth by fostering collaboration").count).toBe(2);
  });
});

describe("compileWeightedStems", () => {
  it("parses weight per entry", () => {
    const entries = compileWeightedStems("empower 2.5\nenable 0.8\n");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.weight).toBe(2.5);
    expect(entries[1]?.weight).toBe(0.8);
  });

  it("throws on missing weight", () => {
    expect(() => compileWeightedStems("empower\n")).toThrow();
  });

  it("throws on non-positive weight", () => {
    expect(() => compileWeightedStems("empower 0\n")).toThrow();
  });

  it("ignores comments", () => {
    const entries = compileWeightedStems("# header\nempower 1\n");
    expect(entries).toHaveLength(1);
  });
});

describe("weightedStemHits", () => {
  it("accumulates weights from matched stems", () => {
    const entries = compileWeightedStems("empower 2.5\nenable 0.8\n");
    const result = weightedStemHits("this empowers and enables users", entries);
    expect(result.totalWeight).toBeCloseTo(3.3, 1);
    expect(result.samples).toContain("empower");
    expect(result.samples).toContain("enable");
  });

  it("matches inflected forms", () => {
    const entries = compileWeightedStems("streamline 2.5\n");
    const result = weightedStemHits("we streamlined the process", entries);
    expect(result.totalWeight).toBeCloseTo(2.5, 1);
  });

  it("returns zero for no matches", () => {
    const entries = compileWeightedStems("empower 2.5\n");
    const result = weightedStemHits("the function returns a value", entries);
    expect(result.totalWeight).toBe(0);
    expect(result.samples).toHaveLength(0);
  });

  it("counts multiple occurrences of same word", () => {
    const entries = compileWeightedStems("empower 2.5\n");
    const result = weightedStemHits("empower users to empower others", entries);
    expect(result.totalWeight).toBeCloseTo(5.0, 1);
  });
});

describe("compileStemmedPhrases / stemmedPhraseHits", () => {
  const phrases = compileStemmedPhrases("source of truth\nescape hatch\nfail loudly\n");

  it("matches the exact phrase", () => {
    expect(stemmedPhraseHits("a single source of truth here", phrases).count).toBe(1);
  });

  it("matches inflected, hyphenated, and cased variants via stemming", () => {
    expect(stemmedPhraseHits("the canonical sources of truth", phrases).count).toBe(1);
    expect(stemmedPhraseHits("stored as source-of-truth metadata", phrases).count).toBe(1);
    expect(stemmedPhraseHits("treat it as the Source Of Truth", phrases).count).toBe(1);
    expect(stemmedPhraseHits("the test fails loudly", phrases).count).toBe(1);
  });

  it("requires contiguous order, not scattered words", () => {
    expect(stemmedPhraseHits("the truth about the data source", phrases).count).toBe(0);
    expect(stemmedPhraseHits("a hatch you can escape through", phrases).count).toBe(0);
  });

  it("reports the original phrase as the sample", () => {
    expect(stemmedPhraseHits("added an escape hatch", phrases).sample).toBe("escape hatch");
  });

  it("ignores comments and blank lines", () => {
    const compiled = compileStemmedPhrases("# header\n\nsource of truth\n");
    expect(compiled.length).toBe(1);
  });
});

describe("loaded WORDLISTS", () => {
  it("loads vocabulary as stemmed matcher", () => {
    expect(WORDLISTS.vocabulary("we delve into the data").count).toBeGreaterThan(0);
    expect(WORDLISTS.vocabulary("a robust solution").count).toBeGreaterThan(0);
  });

  it("matches inflected vocabulary via stemming", () => {
    expect(WORDLISTS.vocabulary("done meticulously").count).toBeGreaterThan(0);
    expect(WORDLISTS.vocabulary("she leveraged the data").count).toBeGreaterThan(0);
    expect(WORDLISTS.vocabulary("a nuanced take").count).toBeGreaterThan(0);
  });

  it("loads openers (null when file is empty)", () => {
    expect(WORDLISTS.openers).toBeNull();
  });

  it("loads marketing verbs as weighted stems", () => {
    expect(WORDLISTS.marketingVerbs.length).toBeGreaterThan(0);
    const result = weightedStemHits("this empowers users", WORDLISTS.marketingVerbs);
    expect(result.totalWeight).toBeGreaterThan(2);
  });

  it("loads soft phrasing as weighted stems", () => {
    expect(WORDLISTS.softPhrasing.length).toBeGreaterThan(0);
    const result = weightedStemHits("this runs cleanly and exits cleanly", WORDLISTS.softPhrasing);
    expect(result.totalWeight).toBeGreaterThan(2);
  });

  it("loads flowery phrases as stemmed token sequences", () => {
    expect(WORDLISTS.floweryPhrases.map((p) => p.original)).toContain("source of truth");
    expect(WORDLISTS.floweryPhrases.every((p) => p.stems.length > 0)).toBe(true);
  });
});
