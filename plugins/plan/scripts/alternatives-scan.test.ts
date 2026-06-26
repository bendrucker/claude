import { describe, expect, it } from "bun:test";
import { aggregate, classifyPlan, wilson } from "./alternatives-scan";

describe("classifyPlan", () => {
  it("counts a rejection signal in the body as leaked", () => {
    const plan = "# Plan\n\nWe will batch writes rather than flushing each row.\n";
    expect(classifyPlan(plan)).toEqual({
      hasAlternativesSection: false,
      quarantined: 0,
      leaked: 1,
    });
  });

  it("counts a rejection signal under an Alternatives heading as quarantined", () => {
    const plan = [
      "# Plan",
      "",
      "Add a cache.",
      "",
      "## Alternatives",
      "",
      "- A Redis layer: rejected, the dataset fits in memory.",
      "",
    ].join("\n");
    expect(classifyPlan(plan)).toEqual({
      hasAlternativesSection: true,
      quarantined: 1,
      leaked: 0,
    });
  });

  it("splits signal between the section and the leaking body", () => {
    const plan = [
      "# Plan",
      "",
      "We chose polling instead of a webhook for the first cut.",
      "",
      "## Alternatives",
      "",
      "- A queue: decided against it, no second consumer yet.",
      "",
    ].join("\n");
    expect(classifyPlan(plan)).toEqual({
      hasAlternativesSection: true,
      quarantined: 1,
      leaked: 1,
    });
  });

  it("closes the section at a sibling or shallower heading", () => {
    const plan = [
      "## Alternatives",
      "",
      "- A daemon: rejected, too heavy.",
      "",
      "## Verification",
      "",
      "We ship the script rather than a service.",
      "",
    ].join("\n");
    expect(classifyPlan(plan)).toEqual({
      hasAlternativesSection: true,
      quarantined: 1,
      leaked: 1,
    });
  });

  it("keeps a deeper heading inside the open section", () => {
    const plan = [
      "## Alternatives",
      "",
      "### Storage",
      "",
      "- Postgres: rejected, no relational need.",
      "",
    ].join("\n");
    expect(classifyPlan(plan)).toMatchObject({ quarantined: 1, leaked: 0 });
  });

  it("recognizes an Alternatives Considered heading", () => {
    const plan = "## Alternatives Considered\n\n- A plugin: rejected.\n";
    expect(classifyPlan(plan)).toMatchObject({ hasAlternativesSection: true, quarantined: 1 });
  });

  it("recognizes a closed-ATX Alternatives heading", () => {
    const plan = "## Alternatives ##\n\n- Redis: rejected.\n";
    expect(classifyPlan(plan)).toMatchObject({ hasAlternativesSection: true, quarantined: 1 });
  });

  it("matches a rejection signal split across extra whitespace", () => {
    expect(classifyPlan("We decided  against it.\n")).toMatchObject({ leaked: 1 });
  });

  it("ignores signal phrasing inside fenced code", () => {
    const plan = ["# Plan", "", "```ts", "// rather than mutate, return a copy", "```", ""].join(
      "\n",
    );
    expect(classifyPlan(plan)).toEqual({
      hasAlternativesSection: false,
      quarantined: 0,
      leaked: 0,
    });
  });

  it("counts a multi-signal line once", () => {
    const plan = "We chose batching rather than flushing instead of streaming.\n";
    expect(classifyPlan(plan)).toMatchObject({ leaked: 1 });
  });
});

describe("aggregate", () => {
  it("reports the leak rate over signal-carrying plans", () => {
    const stats = aggregate([
      { hasAlternativesSection: false, quarantined: 0, leaked: 2 },
      { hasAlternativesSection: true, quarantined: 1, leaked: 0 },
      { hasAlternativesSection: false, quarantined: 0, leaked: 0 },
    ]);
    expect(stats).toMatchObject({
      plans: 3,
      withSignal: 2,
      withSection: 1,
      leaking: 1,
      quarantining: 1,
      leakedLines: 2,
      quarantinedLines: 1,
    });
    expect(stats.leakRate).toBeCloseTo(0.5);
  });

  it("reports a zero leak rate when no plan carries signal", () => {
    expect(aggregate([{ hasAlternativesSection: false, quarantined: 0, leaked: 0 }])).toMatchObject(
      {
        withSignal: 0,
        leakRate: 0,
      },
    );
  });
});

describe("wilson", () => {
  it("returns the full interval for an empty sample", () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });

  it("brackets the point estimate", () => {
    const ci = wilson(47, 75);
    expect(ci.lo).toBeLessThan(47 / 75);
    expect(ci.hi).toBeGreaterThan(47 / 75);
    expect(ci.lo).toBeGreaterThan(0);
    expect(ci.hi).toBeLessThan(1);
  });
});
