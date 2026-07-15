import { describe, expect, test } from "bun:test";
import type { Verdict } from "../judge/schema";
import { type ReportItem, renderReport, summarize } from "./report";

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
"2 delete / 0 trim / 0 rewrite across 2 file(s)

src/a.ts
  :4  delete  restate-the-what  high
      Paraphrases the line.

src/b.ts
  :9  delete  section-divider  low
      Paraphrases the line."
`);
  });

  test("labels a whole-comment trim as delete and a partial trim as trim, with a keep preview", () => {
    const out = strip(
      renderReport(
        [
          reportItem({ startLine: 2 }),
          reportItem({
            startLine: 8,
            verdict: verdict({ trimTo: "# the broker rate-limits per key" }),
          }),
          reportItem({
            startLine: 14,
            verdict: verdict({
              action: "rewrite",
              category: "voice",
              rewrite: "// the fact",
              rationale: "Voice.",
            }),
          }),
        ],
        { fix: false },
      ),
    );
    expect(out).toMatchInlineSnapshot(`
"1 delete / 1 trim / 1 rewrite across 1 file(s)

src/a.ts
  :2  delete  restate-the-what  high
      Paraphrases the line.
  :8  trim  restate-the-what  high
      Paraphrases the line.
      keep: # the broker rate-limits per key
  :14  rewrite  voice  high
      Voice.
      new: // the fact"
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

describe("summarize", () => {
  test("splits flagged verdicts by delete, trim, and rewrite and counts distinct files", () => {
    const items = [
      reportItem({ path: "src/a.ts" }),
      reportItem({ path: "src/a.ts", verdict: verdict({ trimToLines: [1] }) }),
      reportItem({ path: "src/b.ts", verdict: verdict({ trimTo: "# kept" }) }),
      reportItem({
        path: "src/b.ts",
        verdict: verdict({ action: "rewrite", category: "voice", rewrite: "// fact" }),
      }),
      reportItem({ path: "src/c.ts", verdict: verdict({ action: "keep", category: null }) }),
    ];
    expect(summarize(items)).toBe("1 delete / 2 trim / 1 rewrite across 2 file(s)");
  });
});
