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
    const out = terminalReport([fileCoverage("a.ts", { 1: 1, 2: 0, 3: 0, 4: 1 })]);
    expect(out).toMatchInlineSnapshot(`
      "╔══════╤═════════╤═══════════╗
      ║ File │ % Lines │ Uncovered ║
      ╟──────┼─────────┼───────────╢
      ║ a.ts │ \x1B[31m50.0%\x1B[39m   │ 2-3       ║
      ╚══════╧═════════╧═══════════╝

      Uncovered lines:
      \x1B[31ma.ts\x1B[0m: 2, 3"
    `);
  });

  test("omits the uncovered detail section when everything is covered", () => {
    const out = terminalReport([fileCoverage("a.ts", { 1: 1, 2: 1 })]);
    expect(out).toContain("100.0%");
    expect(out).not.toContain("Uncovered lines:");
  });
});

describe("githubReport", () => {
  test("builds a markdown summary table", () => {
    const summary = githubReport([fileCoverage("a.ts", { 1: 1, 2: 0, 3: 0 })]);
    expect(summary).toMatchInlineSnapshot(`
      "## Coverage

      | File | % Lines | Uncovered |
      | --- | --- | --- |
      | \`a.ts\` | 33.3% | 2-3 |"
    `);
  });

  test("reports no data for an empty set", () => {
    expect(githubReport([])).toBe("## Coverage\n\nNo coverage data.");
  });
});
