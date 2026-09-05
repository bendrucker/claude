import { describe, expect, it } from "bun:test";
import { checkTitleCase } from "../hooks/headings";
import { CLASSIFIERS } from "./classifiers";
import {
  sentenceHeadingNegatives,
  sentenceHeadingPositives,
  titleCaseNegatives,
  titleCasePositives,
} from "./fixtures";
import { classifyHeadingBaseline } from "./heading";

/**
 * The committed regression gate for the heading detectors. It runs in CI
 * via `bun test` (the writing plugin's test job auto-discovers
 * `*.test.ts`). Every assertion that gates is currently green; candidate
 * behavior is tracked, not gated, so the eval-only classifiers can drift
 * without breaking CI for code the hook never ships.
 *
 * All numbers regenerate from the fixtures and the committed classifiers,
 * so there are no hand-pasted snapshots to drift from the code.
 */

describe("sentence-heading false-positive ceiling", () => {
  // The gate: the baseline that ships in the hook flags none of the
  // conventional heading shapes documented in linguistics.md.
  it.each(sentenceHeadingNegatives)("baseline does not flag: $description", ({ heading }) => {
    expect(classifyHeadingBaseline(heading).flagged).toBe(false);
  });

  // Regression visibility for the eval-only candidates: each flags a
  // known number of these negatives today. This is recorded, not gated;
  // promotion of a candidate into the hook would require driving these to
  // zero, and a change here flags drift without failing CI.
  it("records candidate false positives on the negatives", () => {
    const counts = Object.fromEntries(
      CLASSIFIERS.map((classifier) => [
        classifier.name,
        sentenceHeadingNegatives.filter(({ heading }) => classifier.classify(heading).flagged)
          .length,
      ]),
    );
    expect(counts).toEqual({
      baseline: 0,
      "finite-verb:compromise": 2,
      "np-test:compromise": 3,
      "hybrid:compromise": 2,
      "finite-verb:natural": 1,
      "np-test:natural": 1,
      "hybrid:natural": 1,
    });
  });
});

describe("sentence-heading positives", () => {
  // Each positive carries the baseline's actual verdict. Clause shapes are
  // within reach and flagged; imperatives outside the nine-opener word set
  // are recorded as misses (~20% recall per linguistics.md), so this is
  // current behavior, not a recall gate the baseline would fail.
  it.each(sentenceHeadingPositives)("$description", ({ heading, baselineFlagged, kind }) => {
    const verdict = classifyHeadingBaseline(heading);
    expect(verdict.flagged).toBe(baselineFlagged);
    if (kind != null) {
      expect(verdict.kind).toBe(kind);
    }
  });
});

describe("title-case false-positive ceiling", () => {
  // The gate: AP-correct headings from issue #769 must not be flagged.
  it.each(titleCaseNegatives)("accepts: $description", ({ heading }) => {
    expect(checkTitleCase(`## ${heading}`)).toBeNull();
  });

  // The checker's real job stays intact: genuinely mis-cased headings are
  // still flagged after extending the stopword list.
  it.each(titleCasePositives)("flags: $description", ({ heading }) => {
    expect(checkTitleCase(`## ${heading}`)).not.toBeNull();
  });
});
