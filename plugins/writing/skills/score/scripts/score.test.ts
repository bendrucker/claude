import { describe, expect, it } from "bun:test";
import { compileStemmedWordlist } from "../../../detection/wordlists";
import { buildReport, extractComments, renderTable, scoreComments, scoreText } from "./score";

function category(report: ReturnType<typeof buildReport>, group: string, name: string) {
  return report.groups.find((g) => g.group === group)?.categories.find((c) => c.category === name);
}

describe("scoreText", () => {
  it("counts word tokens over stripped code", () => {
    const text = "The function reads input. `ignored code here`";
    const score = scoreText(text, undefined);
    expect(score.wordCount).toBe(4);
  });

  it("reports density as hits per 1000 words", () => {
    // One em dash in a 1000-word body lands at density 1.0.
    const filler = `${"word ".repeat(998)}a — b`;
    const score = scoreText(filler, "doc.md");
    expect(score.wordCount).toBe(1000);
    const emDash = score.categories.find((c) => c.category === "spaced em dash");
    expect(emDash?.hits).toBe(1);
    expect(emDash?.density).toBeCloseTo(1.0, 5);
  });

  it("returns no categories for clean prose", () => {
    const score = scoreText("The function reads input and writes output.", undefined);
    expect(score.categories).toHaveLength(0);
  });

  it("scores a custom vocabulary pass when given a matcher", () => {
    const match = compileStemmedWordlist("widget\n");
    const score = scoreText("The widget powers the widgets.", undefined, match);
    const custom = score.categories.find((c) => c.category === "custom vocabulary");
    expect(custom?.hits).toBe(2);
  });
});

describe("extractComments", () => {
  it("pulls single-line // and # comments and drops the markers", () => {
    const src = ["const x = 1; // leverage the cache", "# delve into config", "code()"].join("\n");
    const comments = extractComments(src);
    expect(comments).toContain("leverage the cache");
    expect(comments).toContain("delve into config");
    expect(comments).not.toContain("code()");
  });
});

describe("scoreComments", () => {
  it("scores extracted comments as a separate prose group", () => {
    const src = "function f() {\n  // We reach for the helper here.\n  return 1;\n}\n";
    const group = scoreComments(src);
    expect(group?.group).toBe("comments");
    const reaching = group?.categories.find((c) => c.category === "reaching for");
    expect(reaching?.hits).toBe(1);
  });

  it("returns undefined when there are no comments", () => {
    expect(scoreComments("const x = 1;\nconst y = 2;\n")).toBeUndefined();
  });
});

describe("buildReport", () => {
  it("emits only the prose group when comments are off", () => {
    const report = buildReport("// leverage this", "src.ts", { comments: false });
    expect(report.groups.map((g) => g.group)).toEqual(["prose"]);
  });

  it("adds a comments group when comments are on", () => {
    const src = "function f() {\n  // We delve into the leverage here today.\n}\n";
    const report = buildReport(src, "src.ts", { comments: true });
    expect(report.groups.map((g) => g.group)).toContain("comments");
    expect(category(report, "comments", "AI vocabulary")?.hits).toBeGreaterThan(0);
  });

  it("applies the custom matcher to every group", () => {
    const match = compileStemmedWordlist("widget\n");
    const src = "const w = 1; // a widget comment\nwidget();\n";
    const report = buildReport(src, "src.ts", { comments: true, customMatch: match });
    expect(category(report, "prose", "custom vocabulary")?.hits).toBe(2);
    expect(category(report, "comments", "custom vocabulary")?.hits).toBe(1);
  });
});

describe("renderTable", () => {
  it("renders a header with word count and a category row", () => {
    const report = buildReport("a — b", "doc.md", { comments: false });
    const out = renderTable(report);
    expect(out).toContain("prose (2 words)");
    expect(out).toContain("spaced em dash");
    expect(out).toContain("Density /1k");
  });

  it("reports no patterns for clean prose", () => {
    const report = buildReport("The function reads input.", "doc.md", { comments: false });
    expect(renderTable(report)).toContain("No patterns detected.");
  });
});
