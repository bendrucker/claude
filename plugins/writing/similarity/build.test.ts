import { expect, test } from "bun:test";
import { buildStyleProfile } from "./build";
import { LADDER_SIZE } from "./calibration";
import { contrastCorpus, fixtureProfile, voiceCorpus } from "./fixtures";
import { StyleProfile } from "./profile";
import { RHYTHM_FEATURE_IDS } from "./rhythm";

const profile = fixtureProfile();

test("the built profile validates against its own schema", () => {
  expect(() => StyleProfile.parse(JSON.parse(JSON.stringify(profile)))).not.toThrow();
});

test("the profile carries both poles and the transforms into their space", () => {
  expect(profile.featureIds).toEqual(RHYTHM_FEATURE_IDS);
  expect(profile.scaler.mean).toHaveLength(RHYTHM_FEATURE_IDS.length);
  expect(profile.charVocabulary).toHaveLength(120);
  expect(profile.voice.documentCount).toBe(40);
  expect(profile.contrast.documentCount).toBe(40);
});

test("the poles sit apart in the standardized space", () => {
  const gap = profile.voice.rhythmCentroid.map((value, i) =>
    Math.abs(value - (profile.contrast.rhythmCentroid[i] ?? 0)),
  );
  expect(Math.max(...gap)).toBeGreaterThan(1);
});

test("both calibration ladders are populated and ascending", () => {
  for (const set of [profile.documentCalibration, profile.windowCalibration]) {
    for (const calibration of [set.rhythm, set.char, set.fused]) {
      expect(calibration.ladder).toHaveLength(LADDER_SIZE);
      expect(calibration.sampleSize).toBeGreaterThan(0);
      expect(calibration.ladder.toSorted((a, b) => a - b)).toEqual(calibration.ladder);
    }
  }
});

test("the window ladder is capped per document", () => {
  expect(profile.windowCalibration.fused.sampleSize).toBeLessThanOrEqual(40 * 12);
});

test("documents below the word floor are reported as skipped", () => {
  const { skipped } = buildStyleProfile(
    [...voiceCorpus(5), { source: "tiny", body: "Too short. Way too short. Yes." }],
    contrastCorpus(5),
    { generatedAt: "2026-01-01", vocabularySize: 50, minWords: 40 },
  );
  expect(skipped.voice).toBe(1);
  expect(skipped.contrast).toBe(0);
});

test("an empty pole is a build error", () => {
  expect(() =>
    buildStyleProfile(voiceCorpus(5), [], { generatedAt: "2026-01-01", minWords: 40 }),
  ).toThrow(/contrast/);
  expect(() =>
    buildStyleProfile([], contrastCorpus(5), { generatedAt: "2026-01-01", minWords: 40 }),
  ).toThrow(/voice/);
});

test("the build is deterministic over the same corpora", () => {
  const options = { generatedAt: "2026-01-01", vocabularySize: 120, minWords: 40 };
  const first = buildStyleProfile(voiceCorpus(), contrastCorpus(), options).profile;
  const second = buildStyleProfile(voiceCorpus(), contrastCorpus(), options).profile;
  expect(first).toEqual(second);
});
