import { describe, expect, it, test } from "bun:test";
import { scanAll } from "./scan";

describe("scanAll", () => {
  it("reports line and column for an em dash", async () => {
    const text = "First line.\nA spaced — dash here.";
    const match = (await scanAll(text)).find((r) => r.category === "Writing.SpacedEmDash");
    expect(match).toBeDefined();
    expect(match?.line).toBe(2);
    expect(match?.col).toBe(9);
  });

  it("reports every match without per-tier dedup", async () => {
    // Both are deny-tier: scan() keeps one per tier, scanAll reports both.
    const text = "The ordering is load-bearing and the code reaches for the helper.";
    const categories = (await scanAll(text)).map((r) => r.category);
    expect(categories).toContain("Writing.LoadBearing");
    expect(categories).toContain("Writing.ReachingFor");
  });

  it("reports each occurrence of a regex pattern", async () => {
    const text = "We reach for one tool, then reach for another.";
    const reaching = (await scanAll(text)).filter((r) => r.category === "Writing.ReachingFor");
    expect(reaching.length).toBe(2);
  });

  it("catches a flowery phrase, a stacked soft phrase, and an em dash together", async () => {
    const text = [
      "This keeps a single source of truth — always.",
      "The migration runs cleanly and the tests strip cleanly.",
    ].join("\n");
    const categories = new Set((await scanAll(text, "doc.md")).map((r) => r.category));
    expect(categories.has("Writing.FloweryPhrases")).toBe(true);
    expect(categories.has("Writing.SoftPhrasing")).toBe(true);
    expect(categories.has("Writing.SpacedEmDash")).toBe(true);
  });

  const dense =
    "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.";

  test.each<[string, string | undefined, boolean]>([
    ["applies fileOnly patterns for prose files", "notes.md", true],
    ["skips fileOnly patterns for non-prose files", "script.ts", false],
    ["applies fileOnly patterns when no path is given", undefined, true],
  ])("%s", async (_name, path, contains) => {
    const categories = (await scanAll(dense, path)).map((r) => r.category);
    contains
      ? expect(categories).toContain("connector density")
      : expect(categories).not.toContain("connector density");
  });

  it("reports the position of the connector density sample", async () => {
    const match = (await scanAll(dense, "notes.md")).find(
      (r) => r.category === "connector density",
    );
    expect(match).toBeDefined();
    expect(match?.line).toBe(1);
    expect(match?.col).toBe(2);
  });

  it("does not report sideEffectOnly patterns", async () => {
    const categories = (await scanAll("Excellent. That works.\nYou're right about that.")).map(
      (r) => r.category,
    );
    expect(categories).not.toContain("sycophantic opener");
  });

  it("returns positions sorted by line then column", async () => {
    const text = "We leverage — here.\nWe delve into more.";
    const results = await scanAll(text);
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

  it("maps positions through stripped code without shifting lines", async () => {
    const text = ["```", "reach for it", "```", "Then we reach for the result."].join("\n");
    const match = (await scanAll(text, "doc.md")).find((r) => r.category === "Writing.ReachingFor");
    expect(match?.line).toBe(4);
  });

  it("reports the real line and column for a test-result match", async () => {
    const text = "First line.\nSecond line.\nAll 8 tests pass now.";
    const match = (await scanAll(text)).find((r) => r.category === "Writing.TestResultReporting");
    expect(match).toBeDefined();
    expect(match?.line).toBe(3);
    expect(match?.col).toBe(1);
  });

  it.each([
    ["Writing.RidesOn", "The teardown rides on the normal end of a team."],
    ["Writing.CanBite", "A stale cache entry can bite at runtime."],
    ["surface as verb", "The hook should surface the conflict to the user."],
  ])("reports the skillOnly %s pattern", async (category, text) => {
    expect((await scanAll(text, "doc.md")).map((r) => r.category)).toContain(category);
  });

  it("returns empty for clean prose", async () => {
    expect(await scanAll("The function reads input and writes output.")).toHaveLength(0);
  });

  it("reports a weighted group once when threshold is cleared by repeated hits", async () => {
    const text = "One: empowers users. Two: empowers teams.";
    const marketing = (await scanAll(text)).filter((r) => r.category === "Writing.MarketingVerbs");
    expect(marketing).toHaveLength(1);
  });
});
