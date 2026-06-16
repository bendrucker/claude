import { describe, expect, test } from "bun:test";
import type { FileCoverage } from "./lcov";
import { githubReport, terminalReport } from "./report";

function fileCoverage(file: string, hits: Record<number, number>): FileCoverage {
  return {
    file,
    lineHits: new Map(Object.entries(hits).map(([line, count]) => [Number(line), count])),
    functionsFound: 1,
    functionsHit: 1,
  };
}

describe("terminalReport", () => {
  test("reports no data for an empty set", () => {
    expect(terminalReport([])).toBe("No coverage data.");
  });

  test("lists files, percentages, and uncovered ranges", () => {
    // Color codes wrap the percentage and detail file name, so assert on
    // substrings that survive between the escapes.
    const out = terminalReport([fileCoverage("a.ts", { 1: 1, 2: 0, 3: 0, 4: 1 })]);
    expect(out).toContain("a.ts");
    expect(out).toContain("50.0%");
    expect(out).toContain("2-3");
    expect(out).toContain("Uncovered lines:");
    expect(out).toContain(": 2, 3");
  });

  test("omits the uncovered detail section when everything is covered", () => {
    const out = terminalReport([fileCoverage("a.ts", { 1: 1, 2: 1 })]);
    expect(out).toContain("100.0%");
    expect(out).not.toContain("Uncovered lines:");
  });
});

describe("githubReport", () => {
  const reports = [fileCoverage("a.ts", { 1: 1, 2: 0, 3: 0 })];

  test("builds a markdown summary table", () => {
    const { summary } = githubReport(reports);
    expect(summary).toContain("## Coverage");
    expect(summary).toContain("| `a.ts` |");
  });

  test("annotates every uncovered line without a changed-lines filter", () => {
    const { annotations } = githubReport(reports);
    expect(annotations).toEqual([
      "::warning file=a.ts,line=2::Line not covered by tests",
      "::warning file=a.ts,line=3::Line not covered by tests",
    ]);
  });

  test("restricts annotations to changed lines", () => {
    const changed = new Map([["a.ts", new Set([3])]]);
    const { annotations } = githubReport(reports, changed);
    expect(annotations).toEqual(["::warning file=a.ts,line=3::Line not covered by tests"]);
  });

  test("emits no annotations when no changed lines are uncovered", () => {
    const changed = new Map([["a.ts", new Set([1])]]);
    expect(githubReport(reports, changed).annotations).toEqual([]);
  });
});
