import { describe, expect, it } from "bun:test";
import { composeTreatment, parseJudge, resolveComparison, resolveSide, summarize } from "./ab";

const TIE_QUALITIES = {
  right_sized_detail: "tie",
  outcome_focused: "tie",
  scope_discipline: "tie",
  grounded: "tie",
} as const;

describe("composeTreatment", () => {
  it("appends the candidate after the baseline", () => {
    const baseline = "## Grounding\n\nRead before you propose.\n";
    const candidate = "## Alternatives\n\nOptional and rare.\n";
    const treatment = composeTreatment(baseline, candidate);
    expect(treatment).toContain("## Grounding");
    expect(treatment).toContain("Read before you propose.");
    expect(treatment).toContain("## Alternatives");
    expect(treatment).toContain("Optional and rare.");
    expect(treatment.indexOf("## Grounding")).toBeLessThan(treatment.indexOf("## Alternatives"));
  });

  it("separates baseline and candidate with a blank line and ends with a newline", () => {
    const treatment = composeTreatment("baseline text", "candidate text");
    expect(treatment).toBe("baseline text\n\ncandidate text\n");
  });

  it("collapses surrounding whitespace so spacing is stable", () => {
    const treatment = composeTreatment("baseline\n\n\n", "\n\ncandidate\n\n");
    expect(treatment).toBe("baseline\n\ncandidate\n");
  });
});

describe("parseJudge", () => {
  it("parses a fenced JSON object", () => {
    const output = [
      "Here is the verdict:",
      "```json",
      '{ "overall": "B", "qualities": { "right_sized_detail": "A", "outcome_focused": "B", "scope_discipline": "tie", "grounded": "B" }, "rationale": "B scoped tighter." }',
      "```",
    ].join("\n");
    expect(parseJudge(output)).toEqual({
      overall: "B",
      qualities: {
        right_sized_detail: "A",
        outcome_focused: "B",
        scope_discipline: "tie",
        grounded: "B",
      },
      rationale: "B scoped tighter.",
    });
  });

  it("defaults missing qualities to tie", () => {
    const output = '{ "overall": "A", "qualities": { "grounded": "A" } }';
    expect(parseJudge(output)).toEqual({
      overall: "A",
      qualities: { ...TIE_QUALITIES, grounded: "A" },
      rationale: "",
    });
  });

  it("rejects an invalid overall verdict", () => {
    const output = '{ "overall": "neither", "qualities": {} }';
    expect(() => parseJudge(output)).toThrow(/invalid overall/);
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseJudge("the model refused")).toThrow(/no JSON object/);
  });

  it("ignores trailing prose that contains a stray brace", () => {
    const output = '{ "overall": "A", "qualities": { "grounded": "A" } } Note: B uses }-syntax.';
    expect(parseJudge(output)).toMatchObject({ overall: "A" });
  });

  it("keeps braces that appear inside string values", () => {
    const output = '{ "overall": "B", "rationale": "A proposes a { } block." }';
    expect(parseJudge(output)).toMatchObject({
      overall: "B",
      rationale: "A proposes a { } block.",
    });
  });
});

describe("resolveSide", () => {
  it("maps A to control when control was shown first", () => {
    expect(resolveSide("A", true)).toBe("control");
    expect(resolveSide("B", true)).toBe("treatment");
  });

  it("maps A to treatment when treatment was shown first", () => {
    expect(resolveSide("A", false)).toBe("treatment");
    expect(resolveSide("B", false)).toBe("control");
  });

  it("keeps a tie a tie regardless of order", () => {
    expect(resolveSide("tie", true)).toBe("tie");
    expect(resolveSide("tie", false)).toBe("tie");
  });
});

describe("resolveComparison", () => {
  it("maps overall and every quality back to conditions", () => {
    const judge = {
      overall: "A" as const,
      qualities: {
        right_sized_detail: "A" as const,
        outcome_focused: "B" as const,
        scope_discipline: "tie" as const,
        grounded: "A" as const,
      },
      rationale: "",
    };
    expect(resolveComparison(judge, false)).toEqual({
      overall: "treatment",
      qualities: {
        right_sized_detail: "treatment",
        outcome_focused: "control",
        scope_discipline: "tie",
        grounded: "treatment",
      },
    });
  });
});

describe("summarize", () => {
  it("tallies wins per dimension and rates treatment over decisive comparisons", () => {
    const summary = summarize([
      { overall: "treatment", qualities: TIE_QUALITIES },
      { overall: "treatment", qualities: TIE_QUALITIES },
      { overall: "control", qualities: TIE_QUALITIES },
      { overall: "tie", qualities: TIE_QUALITIES },
    ]);
    expect(summary.n).toBe(4);
    expect(summary.overall).toMatchObject({
      control: 1,
      treatment: 2,
      tie: 1,
      decisive: 3,
    });
    expect(summary.overall.treatmentWinRate).toBeCloseTo(2 / 3);
  });

  it("reports zero rates for an empty result set", () => {
    const summary = summarize([]);
    expect(summary.n).toBe(0);
    expect(summary.overall).toMatchObject({ decisive: 0, treatmentWinRate: 0 });
    expect(summary.qualities.grounded).toMatchObject({ decisive: 0, treatmentWinRate: 0 });
  });
});
