import { describe, expect, test } from "bun:test";
import { contrastLikeText, fixtureProfile, voiceLikeText } from "./fixtures";
import { segment } from "./segment";
import { flagWindows, localize, slidingWindows } from "./windows";

const profile = fixtureProfile();

describe("slidingWindows", () => {
  const sentences = ["a", "b", "c", "d", "e"];

  test.each([
    [
      "step of one",
      sentences,
      4,
      [
        ["a", "b", "c", "d"],
        ["b", "c", "d", "e"],
      ],
    ],
    ["shorter than the window", ["a", "b"], 4, []],
    ["exactly the window", ["a", "b"], 2, [["a", "b"]]],
    ["nothing to window", [], 4, []],
  ])("%s", (_name, input, size, expected) => {
    expect(slidingWindows(input, size)).toEqual(expected);
  });
});

test("a contrast-like passage inside voice-like prose is the flagged window", () => {
  const text = [voiceLikeText(), contrastLikeText(), voiceLikeText()].join(" ");
  const flagged = flagWindows(localize(segment(text), profile), 10);
  expect(flagged.length).toBeGreaterThan(0);
  expect(flagged[0]?.excerpt).toContain("comprehensive solution");
});

function flaggedShare(text: string, threshold: number): number {
  const windows = localize(segment(text), profile);
  return flagWindows(windows, threshold).length / windows.length;
}

test("voice-like prose flags a fraction of the windows contrast prose does", () => {
  expect(flaggedShare(contrastLikeText(), 10)).toBe(1);
  expect(flaggedShare(voiceLikeText(), 10)).toBeLessThan(0.3);
});

test("flagged windows come back worst first", () => {
  const flagged = flagWindows(
    localize(segment([voiceLikeText(), contrastLikeText()].join(" ")), profile),
    50,
  );
  const percentiles = flagged.map((window) => window.percentile);
  expect(percentiles).toEqual(percentiles.toSorted((a, b) => a - b));
});

test("a flagged window names the features that put it there", () => {
  const flagged = flagWindows(localize(segment(contrastLikeText()), profile), 50);
  const messages = flagged.flatMap((window) => window.issues.map((issue) => issue.message));
  expect(messages).toContain("run-on sentences with many commas");
  expect(messages).toContain("sentences run long");
});

test("localize reports window position against the input's sentences", () => {
  const windows = localize(
    segment("One. Two here. Three of them. Four is next. Five ends it."),
    profile,
  );
  expect(windows).toHaveLength(2);
  expect(windows[0]?.startSentence).toBe(0);
  expect(windows[1]?.sentences).toEqual([
    "Two here.",
    "Three of them.",
    "Four is next.",
    "Five ends it.",
  ]);
});
