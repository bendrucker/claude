import { describe, expect, it } from "bun:test";
import {
  compilePlainWordlist,
  compileStemmedWordlist,
  compileWeightedStems,
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
    expect(re?.source).toBe("\\b(?:foo)\\b");
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

describe("loaded WORDLISTS", () => {
  it("loads vocabulary as stemmed matcher", () => {
    expect(WORDLISTS.vocabulary("we delve into the data").count).toBeGreaterThan(0);
    expect(WORDLISTS.vocabulary("the myriad options").count).toBeGreaterThan(0);
  });

  it("matches inflected vocabulary via stemming", () => {
    expect(WORDLISTS.vocabulary("done meticulously").count).toBeGreaterThan(0);
    expect(WORDLISTS.vocabulary("she garnered support").count).toBeGreaterThan(0);
    expect(WORDLISTS.vocabulary("by fostering growth").count).toBeGreaterThan(0);
  });

  it("loads openers", () => {
    expect("Perfect.".match(WORDLISTS.openers)).not.toBeNull();
    expect("Excellent! Moving on.".match(WORDLISTS.openers)).not.toBeNull();
    expect("this was a perfect example".match(WORDLISTS.openers)).toBeNull();
  });

  it("loads let-me verbs", () => {
    expect("now let me check the file".match(WORDLISTS.letMeVerbs)).not.toBeNull();
    expect("let me verify the output".match(WORDLISTS.letMeVerbs)).not.toBeNull();
    expect("she wouldn't let me near it".match(WORDLISTS.letMeVerbs)).toBeNull();
  });

  it("loads marketing verbs as weighted stems", () => {
    expect(WORDLISTS.marketingVerbs.length).toBeGreaterThan(0);
    const result = weightedStemHits("this empowers users", WORDLISTS.marketingVerbs);
    expect(result.totalWeight).toBeGreaterThan(2);
  });
});
