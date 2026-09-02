import { describe, expect, test } from "bun:test";
import { contrastLikeText, fixtureProfile, voiceLikeText } from "./fixtures";
import { renderReport, type Report, truncate } from "./report";
import { scoreDocument } from "./score";
import { segment } from "./segment";
import { flagWindows, localize } from "./windows";

const profile = fixtureProfile();

function report(text: string, threshold = 10): Report {
  const windows = localize(segment(text), profile);
  return {
    input: "draft.md",
    score: scoreDocument(segment(text), profile, profile.documentCalibration),
    flagged: flagWindows(windows, threshold),
    windowCount: windows.length,
    threshold,
  };
}

describe("truncate", () => {
  test.each([
    ["under the width", "short text", 20, "short text"],
    ["over the width", "abcdefghij", 5, "abcd…"],
    ["collapses whitespace", "a\n\n  b", 20, "a b"],
  ])("%s", (_name, input, width, expected) => {
    expect(truncate(input, width)).toBe(expected);
  });
});

test("voice-like draft report", () => {
  expect(renderReport(report(voiceLikeText()), profile)).toMatchSnapshot();
});

test("contrast-like draft report", () => {
  expect(renderReport(report(contrastLikeText(), 25), profile)).toMatchSnapshot();
});

test("mixed draft report at a narrow excerpt width", () => {
  const mixed = [voiceLikeText(), contrastLikeText()].join(" ");
  expect(renderReport(report(mixed, 25), profile, 60)).toMatchSnapshot();
});

test("a short input carries the noise warning", () => {
  expect(renderReport(report("One. Two here. Three of them."), profile)).toContain(
    "the score is noisy at this length",
  );
  const long = [voiceLikeText(), voiceLikeText()].join("\n\n");
  expect(renderReport(report(long), profile)).not.toContain("noisy at this length");
});

test("the report names the input, falling back to stdin", () => {
  const anonymous = { ...report(voiceLikeText()), input: undefined };
  expect(renderReport(anonymous, profile)).toContain("(stdin)");
});
