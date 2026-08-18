import { describe, expect, test } from "bun:test";
import {
  ANGLES,
  buildPrompt,
  type Diff,
  daysUntilReset,
  deriveUsage,
  exceedsEntitlement,
  type Meter,
  resolveTier,
  splitPaths,
  type Tier,
} from "./review";

describe("splitPaths", () => {
  // git only emits these intact with -z. Newline splitting turns each into a path that
  // does not exist, and the file silently drops out of the review.
  test.each([
    ["plain", "a.ts\0b.ts\0", ["a.ts", "b.ts"]],
    ["non-ascii", "café.ts\0", ["café.ts"]],
    ["newline in name", "we\nird.ts\0ok.ts\0", ["we\nird.ts", "ok.ts"]],
    ["no trailing separator", "only.ts", ["only.ts"]],
    ["empty", "", []],
  ])("%s", (_name, output, expected) => {
    expect(splitPaths(output)).toEqual(expected);
  });
});

describe("buildPrompt", () => {
  const diff: Diff = { base: "origin/main", patch: "@@ -1 +1 @@\n-old\n+new", files: ["a.ts"] };

  test("carries the diff, the focus, and the file body", () => {
    const prompt = buildPrompt(diff, new Map([["a.ts", "export const x = 1;"]]), [], "FOCUS HERE");

    expect(prompt).toContain("FOCUS HERE");
    expect(prompt).toContain("## Diff (against origin/main)");
    expect(prompt).toContain("+new");
    expect(prompt).toContain("### a.ts");
    expect(prompt).toContain("export const x = 1;");
    expect(prompt).toContain("Do NOT summarize the change");
  });

  test("names omitted files so the model knows its view is partial", () => {
    const prompt = buildPrompt(diff, new Map(), ["huge.ts"], "FOCUS");

    expect(prompt).toContain("Not included in full because of size: huge.ts");
    expect(prompt).not.toContain("## Full contents");
  });

  // The one-shot rules forbid reading files, which is correct when the prompt is everything
  // the model gets and actively wrong when it is sitting in a checkout.
  test("tells an agentic run to read the repository instead of forbidding it", () => {
    const prompt = buildPrompt(diff, new Map(), [], "FOCUS", true);

    expect(prompt).toContain("disposable checkout");
    expect(prompt).not.toContain("You have no filesystem or network access");
    expect(prompt).toContain("Do NOT edit, create, or delete any file");
  });
});

describe("budget", () => {
  test.each<[string, number, Tier]>([
    ["drained", 10, "constrained"],
    ["at the constrained edge", 24.9, "constrained"],
    ["nominal daily allowance", 48.4, "normal"],
    ["at the abundant edge", 60, "normal"],
    ["spending down a surplus", 75, "abundant"],
  ])("%s pace reads %p as %s", (_name, pace, tier) => {
    expect(resolveTier(pace)).toBe(tier);
  });

  test.each([
    ["mid-cycle", "2026-09-01", "2026-08-18T03:53:00Z", 14],
    ["partial day rounds up", "2026-09-01", "2026-08-31T23:00:00Z", 1],
    // Without the floor, reset day divides by zero and every pace reads abundant.
    ["reset day floors at one", "2026-09-01", "2026-09-01T12:00:00Z", 1],
    ["past the reset floors at one", "2026-09-01", "2026-09-03T00:00:00Z", 1],
  ])("%s", (_name, resetDate, now, expected) => {
    expect(daysUntilReset(resetDate, new Date(now))).toBe(expected);
  });

  test("refuses an unparseable reset date rather than guessing a pace", () => {
    expect(() => daysUntilReset("", new Date())).toThrow("Unparseable");
  });

  // Each of these derives the other. Defaulting an absent credits_used to 0 would read an
  // account with 10 credits left as untouched, and the guard would clear every shape.
  test.each<[string, Record<string, unknown>, number, number]>([
    ["both reported", { entitlement: 1500, credits_used: 447, remaining: 1052 }, 447, 1052],
    ["only credits_used", { entitlement: 1500, credits_used: 1490 }, 1490, 10],
    ["only remaining", { entitlement: 1500, remaining: 10 }, 1490, 10],
  ])("%s", (_name, snapshot, used, remaining) => {
    expect(deriveUsage(snapshot, 1500)).toEqual({ used, remaining });
  });

  test("refuses a quota that reports neither figure", () => {
    expect(() => deriveUsage({ entitlement: 1500 }, 1500)).toThrow("neither");
  });

  const meter = (used: number): Meter => ({
    used,
    remaining: 1500 - used,
    entitlement: 1500,
    resetDate: "2026-09-01",
    days: 14,
    pace: (1500 - used) / 14,
    tier: "abundant",
  });

  // The reserve is the whole session cap plus the soft-cap overshoot, so the wall arrives
  // well before the entitlement does. That gap is the stranding the guard trades for safety.
  test.each([
    ["a fresh month clears every shape", 0, 90, false],
    ["3 angles fit at exactly the boundary", 1385, 90, false],
    ["3 angles refuse one credit past it", 1386, 90, true],
    ["agentic fits at exactly the boundary", 1415, 60, false],
    ["agentic refuses one credit past it", 1416, 60, true],
    ["a degraded single angle still fits", 1400, 30, false],
  ])("%s", (_name, used, plannedCap, expected) => {
    expect(exceedsEntitlement(meter(used), plannedCap)).toBe(expected);
  });
});

describe("angles", () => {
  test("stay disjoint so extra calls buy coverage rather than agreement", () => {
    expect(ANGLES).toHaveLength(3);
    expect(new Set(ANGLES.map((angle) => angle.id)).size).toBe(3);
    for (const angle of ANGLES) {
      expect(angle.focus).toContain("Look ONLY for these two classes");
    }
  });
});
