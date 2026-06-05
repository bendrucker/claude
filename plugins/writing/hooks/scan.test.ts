import { describe, expect, it } from "bun:test";
import { scanAll } from "./scan";

describe("scanAll", () => {
  it("reports line and column for an em dash", () => {
    const text = "First line.\nA spaced — dash here.";
    const match = scanAll(text).find((r) => r.category === "spaced em dash");
    expect(match).toBeDefined();
    expect(match?.line).toBe(2);
    expect(match?.col).toBe(9);
  });

  it("reports every match without per-tier dedup", () => {
    // Both are deny-tier: scan() keeps one per tier, scanAll reports both.
    const text = "The module serves as the entry point and reaches for the helper.";
    const categories = scanAll(text).map((r) => r.category);
    expect(categories).toContain("copula avoidance");
    expect(categories).toContain("reaching for");
  });

  it("reports each occurrence of a regex pattern", () => {
    const text = "We reach for one tool, then reach for another.";
    const reaching = scanAll(text).filter((r) => r.category === "reaching for");
    expect(reaching.length).toBe(2);
  });

  it("catches a flowery phrase, a stacked soft phrase, and an em dash together", () => {
    const text = [
      "This keeps a single source of truth — always.",
      "The migration runs cleanly and the tests strip cleanly.",
    ].join("\n");
    const categories = new Set(scanAll(text, "doc.md").map((r) => r.category));
    expect(categories.has("flowery phrasing")).toBe(true);
    expect(categories.has("soft phrasing")).toBe(true);
    expect(categories.has("spaced em dash")).toBe(true);
  });

  it("applies fileOnly patterns for prose files", () => {
    const text = "First clause; second clause; third clause; fourth.";
    const categories = scanAll(text, "notes.md").map((r) => r.category);
    expect(categories).toContain("semicolon overuse");
  });

  it("skips fileOnly patterns for non-prose files", () => {
    const text = "First clause; second clause; third clause; fourth.";
    const categories = scanAll(text, "script.ts").map((r) => r.category);
    expect(categories).not.toContain("semicolon overuse");
  });

  it("applies fileOnly patterns when no path is given", () => {
    const text = "First clause; second clause; third clause; fourth.";
    const categories = scanAll(text).map((r) => r.category);
    expect(categories).toContain("semicolon overuse");
  });

  it("does not report sideEffectOnly patterns", () => {
    const categories = scanAll("Excellent. That works.\nYou're right about that.").map(
      (r) => r.category,
    );
    expect(categories).not.toContain("sycophantic opener");
    expect(categories).not.toContain("sycophantic acknowledgment");
  });

  it("returns positions sorted by line then column", () => {
    const text = "We leverage — here.\nWe delve into more.";
    const results = scanAll(text);
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const cur = results[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev && cur) {
        const ordered = prev.line < cur.line || (prev.line === cur.line && prev.col <= cur.col);
        expect(ordered).toBe(true);
      }
    }
  });

  it("maps positions through stripped code without shifting lines", () => {
    const text = ["```", "delve here", "```", "Then we leverage the result."].join("\n");
    const match = scanAll(text, "doc.md").find((r) => r.matched === "leverage");
    expect(match?.line).toBe(4);
  });

  it("reports the real line and column for a test-result match", () => {
    const text = "First line.\nSecond line.\nAll 8 tests pass now.";
    const match = scanAll(text).find((r) => r.category === "test result reporting");
    expect(match).toBeDefined();
    expect(match?.line).toBe(3);
    expect(match?.col).toBe(1);
  });

  it("returns empty for clean prose", () => {
    expect(scanAll("The function reads input and writes output.")).toHaveLength(0);
  });

  it("reports a weighted group once with stacked samples listed", () => {
    const text = "This release empowers users and streamlines deploys to delight teams.";
    const marketing = scanAll(text).filter((r) => r.category === "marketing verbs");
    expect(marketing).toHaveLength(1);
    expect(marketing[0]?.message).toContain("empower");
  });
});
