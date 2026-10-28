import { describe, expect, it } from "bun:test";
import { renderTable, scoreText } from "./score";

describe("scoreText", () => {
  it("counts words as Vale does, leaving out code", async () => {
    const score = await scoreText("The function reads input. `ignored code here`");
    expect(score.wordCount).toBe(4);
  });

  it("reports density as hits per 1000 words", async () => {
    // One em dash in a 1000-word body lands at density 1.0.
    const score = await scoreText(`${"word ".repeat(998)}a — b`);
    expect(score.wordCount).toBe(1000);
    const emDash = score.checks.find((c) => c.check === "Writing.SpacedEmDash");
    expect(emDash?.hits).toBe(1);
    expect(emDash?.density).toBeCloseTo(1.0, 5);
  });

  it("returns no checks for clean prose", async () => {
    const score = await scoreText("The function reads input and writes output.");
    expect(score.checks).toHaveLength(0);
  });
});

describe("renderTable", () => {
  it("header with word count and check rows", async () => {
    expect(renderTable(await scoreText("a — b"))).toMatchInlineSnapshot(`
      "2 words
      ╔══════════════════════╤══════╤═════════════╗
      ║ Check                │ Hits │ Density /1k ║
      ╟──────────────────────┼──────┼─────────────╢
      ║ ai-tells.EmDashUsage │ 1    │ 500.0       ║
      ╟──────────────────────┼──────┼─────────────╢
      ║ Writing.SpacedEmDash │ 1    │ 500.0       ║
      ╚══════════════════════╧══════╧═════════════╝"
    `);
  });

  it("no alerts for clean prose", async () => {
    expect(renderTable(await scoreText("The function reads input."))).toMatchInlineSnapshot(`
      "4 words
      No alerts."
    `);
  });
});
