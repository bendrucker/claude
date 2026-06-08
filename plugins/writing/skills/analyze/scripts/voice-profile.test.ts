import { describe, expect, test } from "bun:test";
import {
  buildProfileFromCorpus,
  phraseProfileStat,
  phraseProfileStatStemmed,
} from "./voice-profile";

const corpus = `===== https://github.com/o/r/pull/1 (2020-01-01, +1/-0) =====
The change updates the cache layer. It updates the cache layer twice.

===== https://github.com/o/r/pull/2 (2020-02-01, +1/-0) =====
Refactors the loader for clarity.
`;

describe("buildProfileFromCorpus", () => {
  test("counts documents, tokens, and word n-grams", () => {
    const profile = buildProfileFromCorpus(corpus, "2026-05-24");
    expect(profile.documentCount).toBe(2);
    expect(profile.totalTokens).toBeGreaterThan(0);
    expect(profile.ngrams["1"]?.updates).toBe(2);
    expect(profile.ngrams["2"]?.["the cache"]).toBe(2);
    expect(profile.ngrams["3"]?.["updates the cache"]).toBe(2);
    expect(profile.sources).toEqual(["github"]);
  });
});

describe("phraseProfileStat", () => {
  const profile = buildProfileFromCorpus(corpus, "2026-05-24");

  test("returns count and per-million for a present bigram", () => {
    const stat = phraseProfileStat(profile, "the cache");
    expect(stat.count).toBe(2);
    expect(stat.perMillion).toBeGreaterThan(0);
  });

  test("returns zero for an absent phrase (the tell signal)", () => {
    const stat = phraseProfileStat(profile, "source of truth");
    expect(stat.count).toBe(0);
    expect(stat.perMillion).toBe(0);
  });

  test("matches a phrase longer than the max profile size by its leading trigram", () => {
    // "updates the cache layer" is 4 tokens; the profile stores up to trigrams,
    // so the lookup uses the leading trigram "updates the cache" (count 2).
    const stat = phraseProfileStat(profile, "updates the cache layer");
    expect(stat.count).toBe(2);
  });

  test("returns zero against an empty profile", () => {
    const empty = buildProfileFromCorpus("", "2026-05-24");
    expect(phraseProfileStat(empty, "anything").count).toBe(0);
  });
});

describe("phraseProfileStatStemmed", () => {
  const inflected = `===== https://github.com/o/r/pull/1 (2020-01-01, +1/-0) =====
The handler fails loudly on bad input. A second guard also fails loudly.
`;
  const profile = buildProfileFromCorpus(inflected, "2026-05-24");

  test("matches an inflected baseline phrase against the rule stem", () => {
    // The baseline says "fails loudly" twice; the wordlist rule is "fail
    // loudly". Stemming both sides makes them match, so the rule is correctly
    // seen as present in the voice baseline (count 2), not absent.
    const stat = phraseProfileStatStemmed(profile, "fail loudly");
    expect(stat.count).toBe(2);
    expect(stat.perMillion).toBeGreaterThan(0);
  });

  test("returns zero for a phrase absent from the stemmed baseline", () => {
    expect(phraseProfileStatStemmed(profile, "source of truth").count).toBe(0);
  });

  test("returns zero against an empty profile", () => {
    const empty = buildProfileFromCorpus("", "2026-05-24");
    expect(phraseProfileStatStemmed(empty, "fail loudly").count).toBe(0);
  });
});
