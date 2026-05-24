import { describe, expect, it } from "bun:test";
import {
  compilePlainWordlist,
  compileWeightedWordlist,
  entryToFragment,
  WORDLISTS,
} from "./wordlists";

describe("entryToFragment", () => {
  it("returns plain stem for bare words", () => {
    expect(entryToFragment("delve")).toBe("delve");
  });

  it("converts (suffix) to optional non-capturing group", () => {
    expect(entryToFragment("meticulous(ly)")).toBe("meticulous(?:ly)?");
  });

  it("converts (a|b) to alternation in optional group", () => {
    expect(entryToFragment("underscore(s|d)")).toBe("underscore(?:s|d)?");
  });

  it("escapes regex metacharacters in bare stems", () => {
    expect(entryToFragment("foo.bar")).toBe("foo\\.bar");
  });
});

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

describe("compileWeightedWordlist", () => {
  it("parses weight per entry", () => {
    const patterns = compileWeightedWordlist("empower(s|ed|ing) 2.5\nenable(s) 0.8\n");
    expect(patterns).toHaveLength(2);
    const empower = patterns[0];
    const enable = patterns[1];
    if (!empower || !enable) throw new Error("expected two patterns");
    expect(empower.weight).toBe(2.5);
    expect(enable.weight).toBe(0.8);
    expect("empowers users".match(empower.pattern)?.[0]).toBe("empowers");
  });

  it("throws on missing weight", () => {
    expect(() => compileWeightedWordlist("empower\n")).toThrow();
  });

  it("throws on non-positive weight", () => {
    expect(() => compileWeightedWordlist("empower 0\n")).toThrow();
  });

  it("ignores comments", () => {
    const patterns = compileWeightedWordlist("# header\nempower 1\n");
    expect(patterns).toHaveLength(1);
  });
});

// The compiled wordlist regexes use the `g` flag, so callers must use
// `.match()` (which doesn't carry state) or reset `lastIndex` before
// `.test()`. These tests use `match()`.
describe("loaded WORDLISTS", () => {
  it("loads vocabulary", () => {
    expect("we delve into the data".match(WORDLISTS.vocabulary)).not.toBeNull();
    expect("the myriad options".match(WORDLISTS.vocabulary)).not.toBeNull();
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

  it("loads marketing verbs as weighted patterns", () => {
    expect(WORDLISTS.marketingVerbs.length).toBeGreaterThan(0);
    const empower = WORDLISTS.marketingVerbs.find(
      (p) => "this empowers users".match(p.pattern) !== null,
    );
    if (!empower) throw new Error("expected empower pattern");
    expect(empower.weight).toBeGreaterThan(2);
  });
});
