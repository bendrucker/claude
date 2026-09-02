import { expect, test } from "bun:test";
import { countGrams, normalizeForGrams, profileFromCounts, selectVocabulary } from "./char-ngrams";

test("normalizeForGrams lowercases and collapses whitespace", () => {
  expect(normalizeForGrams("  A\n  B  ")).toBe("a b");
});

test("countGrams cuts overlapping trigrams across word boundaries", () => {
  expect(Object.fromEntries(countGrams("ab cd"))).toEqual({ "ab ": 1, "b c": 1, " cd": 1 });
});

test("countGrams accumulates into a shared map", () => {
  const counts = countGrams("aaa");
  countGrams("aaa", counts);
  expect(counts.get("aaa")).toBe(2);
});

test("selectVocabulary ranks by count and breaks ties on the gram", () => {
  const counts = new Map([
    ["bbb", 5],
    ["aaa", 1],
    ["ccc", 1],
  ]);
  expect(selectVocabulary(counts, 3)).toEqual(["bbb", "aaa", "ccc"]);
  expect(selectVocabulary(counts, 1)).toEqual(["bbb"]);
});

test("profileFromCounts normalizes over the vocabulary, not the document", () => {
  const counts = new Map([
    ["aaa", 3],
    ["bbb", 1],
    ["zzz", 96],
  ]);
  expect(profileFromCounts(counts, ["aaa", "bbb"])).toEqual([0.75, 0.25]);
});

test("profileFromCounts returns zeros when no vocabulary gram appears", () => {
  expect(profileFromCounts(new Map([["zzz", 4]]), ["aaa", "bbb"])).toEqual([0, 0]);
});
