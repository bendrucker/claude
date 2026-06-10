import { describe, expect, test } from "bun:test";
import {
  HEADINGS_PROMPT_SHA256,
  JUDGE_FIXTURES,
  JUDGE_PROMPT_SHA256,
} from "./judge-fixtures";
import { HEADING_PROMPT_PATH, JUDGE_CRITERIA, loadPrompt, sha256 } from "./judge";

// The reproducibility tuples are (prompt hash, input hash, expected flags).
// This suite keeps the committed hashes in sync without an API key; the live
// half of the gate is `judge-run.ts --gate` (local-only by design).

describe("prompt hash pins", () => {
  test("JUDGE_PROMPT_SHA256 matches the committed prompt artifact", async () => {
    const prompt = await loadPrompt();
    expect(prompt.sha256).toBe(JUDGE_PROMPT_SHA256);
  });

  test("HEADINGS_PROMPT_SHA256 matches the committed headings prompt", async () => {
    const prompt = await loadPrompt(HEADING_PROMPT_PATH);
    expect(prompt.sha256).toBe(HEADINGS_PROMPT_SHA256);
  });
});

describe("fixture tuples", () => {
  test("input hashes match the fixture texts", () => {
    for (const fixture of JUDGE_FIXTURES) {
      expect(sha256(fixture.text)).toBe(fixture.inputSha256);
    }
  });

  test("fixture ids are unique", () => {
    const ids = JUDGE_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("expectations only reference rubric criteria", () => {
    const keys = new Set<string>(JUDGE_CRITERIA.map((c) => c.key));
    for (const fixture of JUDGE_FIXTURES) {
      for (const key of Object.keys(fixture.expect)) {
        expect(keys.has(key)).toBe(true);
      }
    }
  });

  test("negatives pin every criterion false; positives pin their target true", () => {
    for (const fixture of JUDGE_FIXTURES) {
      const expectations = Object.entries(fixture.expect);
      if (fixture.kind === "synthetic-negative") {
        expect(expectations.length).toBe(JUDGE_CRITERIA.length);
        expect(expectations.every(([, flagged]) => flagged === false)).toBe(true);
      } else {
        expect(expectations.some(([, flagged]) => flagged === true)).toBe(true);
      }
    }
  });

  test("every criterion has at least one invented positive", () => {
    for (const criterion of JUDGE_CRITERIA) {
      const covered = JUDGE_FIXTURES.some(
        (f) => f.kind === "invented-positive" && f.expect[criterion.key] === true,
      );
      expect(covered).toBe(true);
    }
  });
});
