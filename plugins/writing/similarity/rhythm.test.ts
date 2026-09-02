import { describe, expect, test } from "bun:test";
import { table } from "table";
import { LEADING_FEATURE_IDS, RHYTHM_FEATURE_IDS, RHYTHM_FEATURES, rhythmVector } from "./rhythm";
import { segment } from "./segment";
import { contrastLikeText, voiceLikeText } from "./fixtures";

test("the feature family is 28 uniquely named features", () => {
  expect(RHYTHM_FEATURES).toHaveLength(28);
  expect(new Set(RHYTHM_FEATURE_IDS).size).toBe(28);
});

test("the leading features are the ones the prototype found separating", () => {
  expect(LEADING_FEATURE_IDS).toEqual([
    "sentenceLengthCv",
    "shortSentenceFraction",
    "commasPerSentence",
    "contractionRate",
    "theDensity",
  ]);
});

test("every feature returns a finite number on empty input", () => {
  const empty = segment("");
  for (const value of rhythmVector(empty)) expect(Number.isFinite(value)).toBe(true);
});

function featureTable(text: string): string {
  const doc = segment(text);
  return table([
    ["Feature", "Value"],
    ...RHYTHM_FEATURES.map((feature) => [feature.id, feature.compute(doc).toFixed(3)]),
  ]);
}

test("voice-like text feature vector", () => {
  expect(featureTable(voiceLikeText())).toMatchSnapshot();
});

test("contrast-like text feature vector", () => {
  expect(featureTable(contrastLikeText())).toMatchSnapshot();
});

describe("the separating features move in the expected direction", () => {
  const voice = segment(voiceLikeText());
  const contrast = segment(contrastLikeText());
  const byId = new Map(RHYTHM_FEATURES.map((feature) => [feature.id, feature]));

  test.each([
    ["shortSentenceFraction", "voice"],
    ["contractionRate", "voice"],
    ["commasPerSentence", "contrast"],
    ["sentenceLengthMean", "contrast"],
    ["longWordFraction", "contrast"],
  ])("%s is higher in %s", (id, higher) => {
    const feature = byId.get(id);
    if (feature === undefined) throw new Error(`no feature ${id}`);
    const voiceValue = feature.compute(voice);
    const contrastValue = feature.compute(contrast);
    if (higher === "voice") expect(voiceValue).toBeGreaterThan(contrastValue);
    else expect(contrastValue).toBeGreaterThan(voiceValue);
  });
});

test("contraction counting skips possessive apostrophes", () => {
  const feature = RHYTHM_FEATURES.find((candidate) => candidate.id === "contractionRate");
  expect(feature?.compute(segment("The parser's output was fine."))).toBe(0);
  expect(feature?.compute(segment("It's fine."))).toBeGreaterThan(0);
});
