import { describe, expect, test } from "bun:test";
import type { Verdict } from "../judge/schema";
import { type ReportItem, renderReport } from "./report";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI, "");

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    isSlop: true,
    category: "restate-the-what",
    confidence: "high",
    rationale: "Paraphrases the line.",
    ...over,
  };
}

function reportItem(over: Partial<ReportItem> = {}): ReportItem {
  return { path: "src/a.ts", startLine: 4, tells: [], verdict: verdict(), ...over };
}

describe("renderReport", () => {
  test("reports nothing for a clean set", () => {
    expect(
      strip(renderReport([reportItem({ verdict: verdict({ isSlop: false }) })], { fix: false })),
    ).toBe("No slop comments found.");
  });

  test("groups flagged findings by file with category, confidence, and rationale", () => {
    const out = strip(
      renderReport(
        [
          reportItem({ path: "src/a.ts", startLine: 4 }),
          reportItem({
            path: "src/b.ts",
            startLine: 9,
            tells: [{ id: "section-banner", reason: "" }],
            verdict: verdict({ category: "section-divider", confidence: "low" }),
          }),
        ],
        { fix: false },
      ),
    );
    expect(out).toMatchInlineSnapshot(`
"src/a.ts
  :4  restate-the-what  high
      Paraphrases the line.

src/b.ts
  :9  section-divider  low [section-banner]
      Paraphrases the line."
`);
  });

  test("includes the suggestion and keep-lines only with --fix", () => {
    const item = reportItem({ verdict: verdict({ suggestedFix: "delete it", trimToLines: [2] }) });
    expect(strip(renderReport([item], { fix: true }))).toContain("fix: delete it");
    expect(strip(renderReport([item], { fix: true }))).toContain("keep lines: 2");
    expect(strip(renderReport([item], { fix: false }))).not.toContain("fix: delete it");
  });
});
