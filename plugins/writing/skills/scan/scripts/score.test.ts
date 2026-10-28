import { describe, expect, it } from "bun:test";
import { buildReport, renderTable, scoreComments, scoreText } from "./score";

function category(report: Awaited<ReturnType<typeof buildReport>>, group: string, name: string) {
  return report.groups.find((g) => g.group === group)?.categories.find((c) => c.category === name);
}

describe("scoreText", () => {
  it("counts word tokens over stripped code", async () => {
    const text = "The function reads input. `ignored code here`";
    const score = await scoreText(text, undefined);
    expect(score.wordCount).toBe(4);
  });

  it("reports density as hits per 1000 words", async () => {
    // One em dash in a 1000-word body lands at density 1.0.
    const filler = `${"word ".repeat(998)}a — b`;
    const score = await scoreText(filler, "doc.md");
    expect(score.wordCount).toBe(1000);
    const emDash = score.categories.find((c) => c.category === "Writing.SpacedEmDash");
    expect(emDash?.hits).toBe(1);
    expect(emDash?.density).toBeCloseTo(1.0, 5);
  });

  it("returns no categories for clean prose", async () => {
    const score = await scoreText("The function reads input and writes output.", undefined);
    expect(score.categories).toHaveLength(0);
  });
});

describe("scoreComments", () => {
  it("scores extracted comments as a separate prose group", async () => {
    const src = "function f() {\n  // We reach for the helper here.\n  return 1;\n}\n";
    const group = await scoreComments(src, "src.ts");
    expect(group?.group).toBe("comments");
    const reaching = group?.categories.find((c) => c.category === "Writing.ReachingFor");
    expect(reaching?.hits).toBe(1);
  });

  it("returns undefined when there are no comments", async () => {
    expect(await scoreComments("const x = 1;\nconst y = 2;\n", "src.ts")).toBeUndefined();
  });
});

describe("buildReport", () => {
  it("emits only the prose group when comments are off", async () => {
    const report = await buildReport("// leverage this", "src.ts", { comments: false });
    expect(report.groups.map((g) => g.group)).toEqual(["prose"]);
  });

  it("adds a comments group when comments are on", async () => {
    const src = "function f() {\n  // We reach for the helper here today.\n}\n";
    const report = await buildReport(src, "src.ts", { comments: true });
    expect(report.groups.map((g) => g.group)).toContain("comments");
    expect(category(report, "comments", "Writing.ReachingFor")?.hits).toBeGreaterThan(0);
  });
});

describe("renderTable", () => {
  it("header with word count and category rows", async () => {
    expect(renderTable(await buildReport("a — b", "doc.md", { comments: false })))
      .toMatchInlineSnapshot(`
      "prose (2 words)
      ╔══════════════════════╤══════╤═════════════╗
      ║ Category             │ Hits │ Density /1k ║
      ╟──────────────────────┼──────┼─────────────╢
      ║ ai-tells.EmDashUsage │ 1    │ 500.0       ║
      ╟──────────────────────┼──────┼─────────────╢
      ║ Writing.SpacedEmDash │ 1    │ 500.0       ║
      ╚══════════════════════╧══════╧═════════════╝"
    `);
  });

  it("no patterns for clean prose", async () => {
    expect(
      renderTable(await buildReport("The function reads input.", "doc.md", { comments: false })),
    ).toMatchInlineSnapshot(`
      "prose (4 words)
      No patterns detected."
    `);
  });
});
