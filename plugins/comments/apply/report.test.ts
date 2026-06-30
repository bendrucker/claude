import { describe, expect, test } from "bun:test";
import type { Verdict } from "../judge/schema";
import { type ReportItem, renderReport } from "./report";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const strip = (s: string) => s.replace(ANSI, "");

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    action: "trim",
    category: "restate-the-what",
    confidence: "high",
    rationale: "Paraphrases the line.",
    rewrite: null,
    ...over,
  };
}

function reportItem(over: Partial<ReportItem> = {}): ReportItem {
  return { path: "src/a.ts", startLine: 4, verdict: verdict(), ...over };
}

describe("renderReport", () => {
  test("reports nothing for a keep-only set", () => {
    expect(
      strip(
        renderReport([reportItem({ verdict: verdict({ action: "keep", category: null }) })], {
          fix: false,
        }),
      ),
    ).toBe("No slop comments found.");
  });

  test("groups flagged findings by file with action, category, confidence, and rationale", () => {
    const out = strip(
      renderReport(
        [
          reportItem({ path: "src/a.ts", startLine: 4 }),
          reportItem({
            path: "src/b.ts",
            startLine: 9,
            verdict: verdict({ category: "section-divider", confidence: "low" }),
          }),
        ],
        { fix: false },
      ),
    );
    expect(out).toMatchInlineSnapshot(`
"src/a.ts
  :4  trim  restate-the-what  high
      Paraphrases the line.

src/b.ts
  :9  trim  section-divider  low
      Paraphrases the line."
`);
  });

  test("shows the old → new preview for a rewrite", () => {
    const out = strip(
      renderReport(
        [
          reportItem({
            text: "// spans all hosts rather than the last one",
            verdict: verdict({
              action: "rewrite",
              category: "voice",
              rewrite: "// each host keeps its own connection",
              rationale: "Carries a fact under contrastive voice.",
            }),
          }),
        ],
        { fix: false },
      ),
    );
    expect(out).toContain("rewrite  voice");
    expect(out).toContain("old: // spans all hosts rather than the last one");
    expect(out).toContain("new: // each host keeps its own connection");
  });

  test("includes the suggestion and keep-lines only with --fix", () => {
    const item = reportItem({ verdict: verdict({ suggestedFix: "delete it", trimToLines: [2] }) });
    expect(strip(renderReport([item], { fix: true }))).toContain("fix: delete it");
    expect(strip(renderReport([item], { fix: true }))).toContain("keep lines: 2");
    expect(strip(renderReport([item], { fix: false }))).not.toContain("fix: delete it");
  });
});
