import { describe, expect, test } from "bun:test";
import { contrastLikeText, fixtureProfile, voiceLikeText } from "./fixtures";
import { featureDeltas, scoreDocument, scoreSegmented } from "./score";
import { segment } from "./segment";

const profile = fixtureProfile();

function score(text: string) {
  return scoreDocument(segment(text), profile, profile.documentCalibration);
}

test("voice-like text lands nearer the voice pole in both families", () => {
  const result = score(voiceLikeText());
  expect(result.rhythm.margin).toBeGreaterThan(0);
  expect(result.char.margin).toBeGreaterThan(0);
  expect(result.fused).toBeGreaterThan(0);
});

test("contrast-like text lands nearer the contrast pole in both families", () => {
  const result = score(contrastLikeText());
  expect(result.rhythm.margin).toBeLessThan(0);
  expect(result.char.margin).toBeLessThan(0);
});

// A held-out voice document does not land at the median of a 40-document
// calibration: each corpus document contributes 2.5% of its own centroid, so
// the in-corpus documents score better than a sample the profile never saw. On
// the real corpus that contribution is four orders of magnitude smaller.
test("the percentile separates a held-out voice document from contrast prose", () => {
  const voice = score(voiceLikeText()).percentile.fused;
  const contrast = score(contrastLikeText()).percentile.fused;
  expect(voice).toBeGreaterThan(20);
  expect(contrast).toBe(0);
});

test("the score reports the input's own size", () => {
  const result = score("One. Two here. Three of them.");
  expect(result.sentences).toBe(3);
  expect(result.words).toBe(6);
});

describe("featureDeltas", () => {
  const deltas = featureDeltas(scoreSegmented(segment(contrastLikeText()), profile), profile);
  const byId = new Map(deltas.map((delta) => [delta.id, delta]));

  test("covers every feature once", () => {
    expect(deltas).toHaveLength(profile.featureIds.length);
  });

  test.each<[string, 1 | -1]>([
    ["commasPerSentence", 1],
    ["contractionRate", -1],
    ["shortSentenceFraction", -1],
  ])("%s points toward the contrast pole in the expected direction", (id, direction) => {
    expect(byId.get(id)?.contrastDirection).toBe(direction);
  });

  test("contrast-like input drifts in the contrast direction", () => {
    const commas = byId.get("commasPerSentence");
    expect(commas?.deviation).toBeGreaterThan(1);
  });
});

test("empty input scores without throwing", () => {
  expect(Number.isFinite(score("").fused)).toBe(true);
});
