import { describe, expect, test } from "bun:test";
import type { LabeledHeading } from "./headings-eval";
import { byCriterion, type CriterionKey, JUDGE_CRITERIA, type JudgeVerdict } from "./judge";
import { JUDGE_PROMPT_SHA256 } from "./judge-fixtures";
import { runGate, scoreHeadingBaseline } from "./judge-run";

function verdictFor(flags: Partial<Record<CriterionKey, boolean>>): JudgeVerdict {
  return byCriterion((key) => {
    const flagged = flags[key] ?? false;
    const id = JUDGE_CRITERIA.find((c) => c.key === key)?.id ?? key;
    return { flagged, span: flagged ? `span for ${id}` : null };
  });
}

describe("runGate", () => {
  test("rejects a stale prompt hash before any judging", () => {
    const judge = () => Promise.resolve(verdictFor({}));
    expect(runGate(judge, "0".repeat(64))).rejects.toThrow("does not match the pinned");
  });

  test("passes when the judge matches every committed expectation", async () => {
    // A mock judge that flags exactly the criterion each positive fixture
    // targets and stays clean on negatives, keyed off the fixture text.
    const judge = (text: string) => {
      const flags: Partial<Record<CriterionKey, boolean>> = {};
      if (text.includes("All 12 tests pass")) flags.information_density = true;
      if (text.includes("Renamed the Config struct")) flags.motivation_presence = true;
      if (text.includes("lightning-fast")) flags.marketing_phrasing = true;
      if (text.includes("should hopefully")) flags.hedging_density = true;
      if (text.includes("Excellent question")) flags.sycophancy = true;
      if (text.includes("## Key Benefits")) flags.press_release_structure = true;
      return Promise.resolve(verdictFor(flags));
    };
    const results = await runGate(judge, JUDGE_PROMPT_SHA256);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.pass)).toBe(true);
  });

  test("reports per-criterion mismatches when the judge drifts", async () => {
    const judge = () => Promise.resolve(verdictFor({ marketing_phrasing: true }));
    const results = await runGate(judge, JUDGE_PROMPT_SHA256);
    const negative = results.find((r) => r.id === "negative-mechanism-first");
    expect(negative?.pass).toBe(false);
    expect(negative?.mismatches).toEqual([
      {
        criterion: "marketing-phrasing",
        expected: false,
        actual: true,
        span: "span for marketing-phrasing",
      },
    ]);
    const density = results.find((r) => r.id === "positive-information-density");
    expect(density?.pass).toBe(false);
    expect(density?.mismatches[0]?.criterion).toBe("information-density");
  });
});

describe("scoreHeadingBaseline", () => {
  const labeled: LabeledHeading[] = [
    { heading: "Throughput Is the Limiting Factor", label: "clause", source: "random" },
    { heading: "Deployment Topology", label: "noun-phrase", source: "random" },
    { heading: "Add a Circuit Breaker to the Gateway", label: "imperative", source: "random" },
    { heading: "Lessons Learned", label: "fragment", source: "disagreement" },
  ];

  test("computes precision and recall against should-flag labels", () => {
    const score = scoreHeadingBaseline(labeled, [true, true, false, false]);
    expect(score.tp).toBe(1);
    expect(score.fp).toBe(1);
    expect(score.fn).toBe(1);
    expect(score.precision).toBe(0.5);
    expect(score.recall).toBe(0.5);
    expect(score.precisionLo).toBeGreaterThan(0);
    expect(score.precisionHi).toBeLessThan(1);
  });

  test("rejects a verdict count mismatch", () => {
    expect(() => scoreHeadingBaseline(labeled, [true])).toThrow("1 verdicts for 4");
  });
});
