import { describe, expect, test } from "bun:test";
import {
  addNgrams,
  cleanText,
  computeLift,
  computeSessionCount,
  excludePhrases,
  processCorpus,
  splitSentences,
  tokenizeSentence,
} from "./ngram";

describe("cleanText", () => {
  test("strips fenced code blocks", () => {
    const text = "before\n```ts\nconst x = 1;\n```\nafter";
    expect(cleanText(text)).not.toContain("const x");
    expect(cleanText(text)).toContain("before");
    expect(cleanText(text)).toContain("after");
  });

  test("strips inline backticks", () => {
    const text = "use `foo()` somewhere";
    expect(cleanText(text)).not.toContain("foo()");
  });

  test("strips URLs", () => {
    expect(cleanText("see https://example.com/x for details")).not.toContain("example.com");
  });

  test("strips path-like tokens", () => {
    expect(cleanText("look in plugins/writing/wordlists")).not.toContain("plugins/writing");
  });

  test("strips CLI flags", () => {
    expect(cleanText("pass --refresh or -f")).not.toMatch(/--refresh/);
  });

  test("strips markdown headers", () => {
    expect(cleanText("# Header\nbody")).not.toContain("Header");
  });
});

describe("splitSentences", () => {
  test("splits on sentence terminators", () => {
    const sents = [...splitSentences("First. Second! Third? Fourth")];
    expect(sents).toEqual(["First", "Second", "Third", "Fourth"]);
  });

  test("ignores empty fragments", () => {
    expect([...splitSentences("...")]).toEqual([]);
  });

  test("splits on newlines too", () => {
    expect([...splitSentences("line one\nline two")]).toEqual(["line one", "line two"]);
  });
});

describe("tokenizeSentence", () => {
  test("lowercases and extracts word tokens", () => {
    expect(tokenizeSentence("Let Me Check This")).toEqual(["let", "me", "check", "this"]);
  });

  test("preserves apostrophes and hyphens", () => {
    expect(tokenizeSentence("you're absolutely right")).toEqual(["you're", "absolutely", "right"]);
  });

  test("drops standalone punctuation and numerics", () => {
    expect(tokenizeSentence("the 5 things")).toEqual(["the", "things"]);
  });
});

describe("addNgrams", () => {
  test("accumulates bigram counts", () => {
    const counts = new Map<string, number>();
    addNgrams(counts, ["a", "b", "c", "b", "c"], 2);
    expect(counts.get("a b")).toBe(1);
    expect(counts.get("b c")).toBe(2);
  });

  test("returns when tokens shorter than n", () => {
    const counts = new Map<string, number>();
    addNgrams(counts, ["a"], 2);
    expect(counts.size).toBe(0);
  });
});

describe("processCorpus", () => {
  test("counts tokens and ngrams", () => {
    const stats = processCorpus("Let me check that. Let me verify too.");
    expect(stats.tokens).toBe(8);
    expect(stats.ngrams.get(2)?.get("let me")).toBe(2);
    expect(stats.ngrams.get(3)?.get("let me check")).toBe(1);
  });

  test("skips code and CLI noise", () => {
    const stats = processCorpus("Run `bun test` to confirm. The result is clean.");
    expect(stats.ngrams.get(2)?.get("bun test")).toBeUndefined();
    expect(stats.ngrams.get(2)?.get("the result")).toBe(1);
  });
});

describe("computeLift", () => {
  test("computes per-million rates and lift ratio", () => {
    const assistant = processCorpus(
      "let me check let me check let me check let me check let me check let me check let me check let me check let me check",
    );
    const user = processCorpus(
      "you should check the value to make sure the result is what you expect each time",
    );
    const rows = computeLift({
      assistant,
      user,
      minAssistantCount: { 2: 2, 3: 2, 4: 2 },
    });
    const letMe = rows.find((r) => r.phrase === "let me");
    expect(letMe).toBeDefined();
    expect(letMe?.assistantCount).toBe(9);
    expect(letMe?.lift).toBeGreaterThan(0);
  });

  test("rows are sorted by lift descending", () => {
    const assistant = processCorpus(
      "alpha beta alpha beta alpha beta gamma delta gamma delta gamma delta",
    );
    const user = processCorpus("gamma delta gamma delta gamma delta gamma delta");
    const rows = computeLift({
      assistant,
      user,
      minAssistantCount: { 2: 2, 3: 2, 4: 2 },
    });
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev && cur) expect(prev.lift).toBeGreaterThanOrEqual(cur.lift);
    }
  });

  test("respects minimum assistant count", () => {
    const assistant = processCorpus("rare phrase appears once only here in this text");
    const user = processCorpus("user has nothing meaningful in common with above text");
    const rows = computeLift({
      assistant,
      user,
      minAssistantCount: { 2: 5, 3: 5, 4: 5 },
    });
    expect(rows.length).toBe(0);
  });

  test("uses Laplace smoothing when phrase is absent from user corpus", () => {
    const assistant = processCorpus("foo bar foo bar foo bar foo bar foo bar");
    const user = processCorpus("completely different words in the user text here now");
    const rows = computeLift({
      assistant,
      user,
      minAssistantCount: { 2: 2, 3: 2, 4: 2 },
    });
    const fooBar = rows.find((r) => r.phrase === "foo bar");
    expect(fooBar).toBeDefined();
    expect(fooBar?.lift).toBeGreaterThan(0);
    expect(fooBar?.lift).toBeLessThan(Infinity);
  });
});

describe("computeSessionCount", () => {
  test("counts distinct sessions per n-gram", () => {
    const rows = [
      { session_id: "s1", text: "let me check the result" },
      { session_id: "s2", text: "let me check another thing" },
      { session_id: "s3", text: "let me check once more" },
    ];
    const spread = computeSessionCount(rows, [3]);
    expect(spread.get("let me check")).toBe(3);
  });

  test("deduplicates within the same session", () => {
    const rows = [{ session_id: "s1", text: "let me check. let me check again" }];
    const spread = computeSessionCount(rows, [3]);
    expect(spread.get("let me check")).toBe(1);
  });

  test("skips rows without text", () => {
    const rows = [{ session_id: "s1" }, { session_id: "s2", text: "some words here now" }];
    const spread = computeSessionCount(rows, [3]);
    expect(spread.size).toBeGreaterThan(0);
  });
});

describe("excludePhrases", () => {
  test("drops phrases already in exclusion set", () => {
    const rows = [makeRow("let me check", 10), makeRow("verify this", 5)];
    const filtered = excludePhrases(rows, new Set(["let me"]));
    expect(filtered.map((r) => r.phrase)).toEqual(["verify this"]);
  });

  test("substring match handles wordlist entries inside longer ngrams", () => {
    const rows = [makeRow("you are absolutely right", 10)];
    const filtered = excludePhrases(rows, new Set(["absolutely right"]));
    expect(filtered).toHaveLength(0);
  });
});

function makeRow(phrase: string, lift: number) {
  return {
    phrase,
    n: phrase.split(" ").length,
    assistantCount: 10,
    userCount: 1,
    assistantPerM: 100,
    userPerM: 10,
    lift,
  };
}
