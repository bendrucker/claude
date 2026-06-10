import { describe, expect, test } from "bun:test";
import { aggregateTrends, analyzeDocument } from "./rate-detectors";

describe("analyzeDocument", () => {
  test("counts words and backtick references", () => {
    const text = "Adds `foo` to `bar`. Removes `baz` from the list.";
    const row = analyzeDocument("s1", text);
    expect(row.wordCount).toBeGreaterThan(0);
    expect(row.backtickRefDensity).toBeGreaterThan(0);
  });

  test("computes action-verb opener rate, skipping first line", () => {
    const text =
      "Adds the cache layer.\nAdds retry logic.\nAdds timeout handling.\nThe server validates input.";
    const row = analyzeDocument("s1", text);
    // Lines 2-4: "Adds retry logic" and "Adds timeout handling" open with action verb; "The server..." does not.
    expect(row.actionVerbOpenerRate).toBeCloseTo(2 / 3);
  });

  test("first line is never counted in action-verb opener rate", () => {
    // Document with only one line: the first line is skipped, so rate is 0.
    const row = analyzeDocument("s1", "Adds the cache layer.");
    expect(row.actionVerbOpenerRate).toBe(0);
  });

  test("detects template sections", () => {
    const text = "Adds retry logic.\n\n## Changes\n\n- Added retry\n\n## Testing\n\nManual.";
    const row = analyzeDocument("s1", text);
    expect(row.hasTemplateSections).toBe(true);
    expect(row.templateSectionCount).toBe(2);
  });

  test("no template sections when absent", () => {
    const row = analyzeDocument("s1", "Adds the cache layer. Fixes the race condition.");
    expect(row.hasTemplateSections).toBe(false);
    expect(row.templateSectionCount).toBe(0);
    expect(row.templateOnSmallDocument).toBe(false);
  });

  test("flags templateOnSmallDocument for short body with both sections", () => {
    const text = "Adds retry logic.\n\n## Changes\n\n- Added retry\n\n## Testing\n\nManual.";
    const row = analyzeDocument("s1", text);
    expect(row.templateOnSmallDocument).toBe(true);
  });

  test("does not flag templateOnSmallDocument when document is large", () => {
    const large = Array(30)
      .fill(
        "The cache reduces round-trips to the database by storing frequently accessed records in memory.",
      )
      .join(" ");
    const text = `${large}\n\n## Changes\n\n- Adds the LRU cache\n\n## Testing\n\nAdded integration tests.`;
    const row = analyzeDocument("s1", text);
    expect(row.templateOnSmallDocument).toBe(false);
  });

  test("does not flag templateOnSmallDocument with only one section", () => {
    const text = "Adds retry logic.\n\n## Changes\n\n- Added retry.";
    const row = analyzeDocument("s1", text);
    expect(row.templateOnSmallDocument).toBe(false);
  });

  test("backtick ref density is per 1k words", () => {
    // 100 words, 10 backtick refs -> 100/1k = 100.0
    const words = Array(95).fill("word").join(" ");
    const backticks = Array(10).fill("`ref`").join(" ");
    const row = analyzeDocument("s1", `${words} ${backticks}`);
    expect(row.backtickRefDensity).toBeCloseTo((10 / row.wordCount) * 1000, 0);
  });

  test("strips code blocks before counting words and verb openers", () => {
    const text = "Adds the cache layer.\n```\nAdds fake code\n```\nUpdates the config.";
    const row = analyzeDocument("s1", text);
    // Only non-code lines: "Adds the cache layer." (first, skipped) and "Updates the config."
    // "Updates" is an action verb opener. Rate should be 1/1 = 1.0 among non-first lines.
    expect(row.actionVerbOpenerRate).toBe(1);
  });
});

describe("aggregateTrends", () => {
  test("returns zero-filled trends for empty input", () => {
    const trends = aggregateTrends([]);
    expect(trends.documentCount).toBe(0);
    expect(trends.meanActionVerbOpenerRate).toBe(0);
    expect(trends.meanBacktickRefDensity).toBe(0);
    expect(trends.templateOnSmallDocumentCount).toBe(0);
  });

  test("averages rates across documents", () => {
    const rows = [
      analyzeDocument("s1", "Adds foo.\nAdds bar.\nUpdates baz."),
      analyzeDocument("s2", "Fixes bug.\nThe server validates input."),
    ];
    const trends = aggregateTrends(rows);
    expect(trends.documentCount).toBe(2);
    expect(trends.meanActionVerbOpenerRate).toBeGreaterThanOrEqual(0);
    expect(trends.meanActionVerbOpenerRate).toBeLessThanOrEqual(1);
  });

  test("computes template document rate", () => {
    const rows = [
      analyzeDocument("s1", "## Changes\n\n- foo\n\n## Testing\n\nbar"),
      analyzeDocument("s2", "Plain prose without sections."),
    ];
    const trends = aggregateTrends(rows);
    expect(trends.templateDocumentRate).toBeCloseTo(0.5);
  });

  test("builds section count distribution", () => {
    const rows = [
      analyzeDocument("s1", "## Changes\n\n- foo\n\n## Testing\n\nbar"),
      analyzeDocument("s2", "Plain prose."),
    ];
    const trends = aggregateTrends(rows);
    expect(trends.sectionCountDistribution[2]).toBe(1);
    expect(trends.sectionCountDistribution[0]).toBe(1);
  });
});
