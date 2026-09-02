import { expect, test } from "bun:test";
import { fixtureProfile } from "./fixtures";
import { loadStyleProfile, saveStyleProfile, type StyleProfile } from "./profile";

const profile = fixtureProfile();

async function writeThenLoad(mutate: (draft: StyleProfile) => void): Promise<StyleProfile | null> {
  const draft = structuredClone(profile);
  mutate(draft);
  const path = `${process.env.TMPDIR ?? "/tmp"}/similarity-profile-${crypto.randomUUID()}.json`;
  await saveStyleProfile(path, draft);
  return loadStyleProfile(path);
}

test("a missing profile is absent rather than an error", async () => {
  expect(await loadStyleProfile(`${process.env.TMPDIR ?? "/tmp"}/no-such-profile.json`)).toBeNull();
});

test("a round trip preserves the profile", async () => {
  expect(await writeThenLoad(() => {})).toEqual(profile);
});

// Every distance is taken index-by-index, so a profile that disagrees with the
// live feature table scores against the wrong columns and returns a number
// nothing downstream can tell is wrong.
test.each([
  ["a renamed feature", (d: StyleProfile) => (d.featureIds = [...d.featureIds].toReversed())],
  ["a dropped feature", (d: StyleProfile) => d.featureIds.pop()],
  ["a truncated scaler", (d: StyleProfile) => d.scaler.mean.pop()],
  ["a truncated centroid", (d: StyleProfile) => d.voice.rhythmCentroid.pop()],
])("%s is rejected", (_name, mutate) => {
  expect(writeThenLoad(mutate)).rejects.toThrow(/stale/i);
});

// The version literal guards the stored shape, so a bump has to reach the same
// guidance the missing-file case gives rather than a raw parse error.
test("a profile from another schema version is rejected", async () => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/similarity-profile-${crypto.randomUUID()}.json`;
  await Bun.write(path, JSON.stringify({ ...profile, version: 99 }));
  expect(loadStyleProfile(path)).rejects.toThrow(/stale/i);
});
