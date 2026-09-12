import { describe, expect, it, test } from "bun:test";
import type { RunLogEntry } from "../../../hooks/run-log";
import {
  acceptance,
  type CategoryHealth,
  type HookHealth,
  opportunities,
  parseLog,
  renderReport,
  summarize,
} from "./hook-health";

function entry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    ts: "2026-07-01T00:00:00.000Z",
    session_id: "s1",
    tool: "Write",
    ext: "md",
    duration_ms: 5,
    outcome: "silent",
    ...overrides,
  };
}

function daysApart(entries: RunLogEntry[], days: number): RunLogEntry[] {
  const start = Date.parse("2026-07-01T00:00:00.000Z");
  return entries.map((item, index) => ({
    ...item,
    ts: new Date(
      start + (index / Math.max(1, entries.length - 1)) * days * 86_400_000,
    ).toISOString(),
  }));
}

describe("parseLog", () => {
  it("reads one entry per line and skips torn writes", () => {
    const text = [
      JSON.stringify(entry()),
      '{"ts":"2026-07-01T00:00:00.000Z","session_id":"s1","tool":"Wr',
      "",
      JSON.stringify(entry({ outcome: "context", category: "numbering" })),
    ].join("\n");
    const entries = parseLog(text);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.category).toBe("numbering");
  });
});

describe("summarize", () => {
  it("aggregates outcomes, tools, categories, and latency", () => {
    const health = summarize([
      entry({ duration_ms: 2 }),
      entry({ duration_ms: 4, tool: "Bash", ext: "" }),
      entry({ outcome: "context", category: "numbering", duration_ms: 10 }),
      entry({ outcome: "silent", category: "numbering", suppressed: true, duration_ms: 1 }),
      entry({ outcome: "deny", category: "spaced em dash", duration_ms: 20 }),
      entry({ outcome: "skipped-scratch", duration_ms: 0 }),
    ]);

    expect(health.total).toBe(6);
    expect(health.injections).toBe(2);
    expect(health.byOutcome.context).toBe(1);
    expect(health.byOutcome["skipped-scratch"]).toBe(1);
    expect(health.byTool.Bash).toBe(1);
    expect(health.categories).toEqual([
      {
        category: "numbering",
        fired: 1,
        suppressed: 1,
        share: 0.5,
        revisited: 0,
        accepted: 0,
        unconfirmed: 0,
      },
      {
        category: "spaced em dash",
        fired: 1,
        suppressed: 0,
        share: 0.5,
        revisited: 0,
        accepted: 0,
        unconfirmed: 0,
      },
    ]);
    expect(health.latency.max).toBe(20);
    expect(health.latency.silentP95).toBe(4);
  });
});

describe("acceptance", () => {
  function shown(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
    return entry({ outcome: "context", category: "numbering", target: "f1", ...overrides });
  }

  it("counts a finding the next checked run no longer raises as acted on", () => {
    const counts = acceptance([shown(), entry({ target: "f1", categories: [] })]);
    expect(counts.get("numbering")).toEqual({ revisited: 1, accepted: 1, unconfirmed: 0 });
  });

  it("counts a finding the next checked run still raises as revisited only", () => {
    const counts = acceptance([shown(), entry({ target: "f1", categories: ["numbering"] })]);
    expect(counts.get("numbering")).toEqual({ revisited: 1, accepted: 0, unconfirmed: 0 });
  });

  it("pairs past a later run that ranked a different category first", () => {
    const counts = acceptance([
      shown(),
      entry({
        outcome: "deny",
        category: "spaced em dash",
        target: "f1",
        categories: ["numbering"],
      }),
    ]);
    expect(counts.get("numbering")).toEqual({ revisited: 1, accepted: 0, unconfirmed: 0 });
  });

  it("leaves a hunk-scoped edit's silence unconfirmed", () => {
    const counts = acceptance([shown(), entry({ tool: "Edit", target: "f1", categories: [] })]);
    expect(counts.get("numbering")).toEqual({ revisited: 0, accepted: 0, unconfirmed: 1 });
  });

  it("counts a hunk-scoped edit that still raises the rule as written past", () => {
    const counts = acceptance([
      shown(),
      entry({ tool: "Edit", target: "f1", categories: ["numbering"] }),
    ]);
    expect(counts.get("numbering")).toEqual({ revisited: 1, accepted: 0, unconfirmed: 0 });
  });

  it("closes the pair on a whole-file re-scan past a silent hunk edit", () => {
    const counts = acceptance([
      shown(),
      entry({ tool: "Edit", target: "f1", categories: [] }),
      entry({ tool: "Write", target: "f1", categories: [] }),
    ]);
    expect(counts.get("numbering")).toEqual({ revisited: 1, accepted: 1, unconfirmed: 0 });
  });

  it("seeds no pair from a suppressed finding", () => {
    const counts = acceptance([
      shown({ outcome: "silent", suppressed: true }),
      entry({ target: "f1", categories: [] }),
    ]);
    expect(counts.size).toBe(0);
  });

  it("closes no pair on a run that returned before the checkers", () => {
    const counts = acceptance([shown(), entry({ target: "f1", outcome: "skipped-scratch" })]);
    expect(counts.size).toBe(0);
  });

  it("pairs only within one session and one file", () => {
    const counts = acceptance([
      shown(),
      entry({ target: "f2", categories: [] }),
      entry({ session_id: "s2", target: "f1", categories: [] }),
    ]);
    expect(counts.size).toBe(0);
  });

  it("ignores entries logged before targets were recorded", () => {
    const counts = acceptance([
      entry({ outcome: "context", category: "numbering" }),
      entry({ categories: [] }),
    ]);
    expect(counts.size).toBe(0);
  });
});

describe("opportunities", () => {
  // Acceptance gates the retirement message, so a baseline that raises nothing
  // still needs pairs closed.
  const measured: CategoryHealth = {
    category: "numbering",
    fired: 10,
    suppressed: 0,
    share: 0.1,
    revisited: 25,
    accepted: 22,
    unconfirmed: 0,
  };

  function baseline(overrides: Partial<HookHealth> = {}): HookHealth {
    const quiet = summarize(
      daysApart(
        Array.from({ length: 100 }, () => entry()),
        7,
      ),
    );
    return { ...quiet, injections: 100, categories: [measured], ...overrides };
  }

  it("asks for more evidence on a thin log", () => {
    const found = opportunities(summarize([entry()]));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Evidence still accumulating");
  });

  it("flags a category dominating injections", () => {
    const health = baseline({
      injections: 100,
      categories: [{ ...measured, category: "test result reporting", fired: 40, share: 0.4 }],
    });
    expect(opportunities(health).join("\n")).toContain("test result reporting");
  });

  it("flags a category suppressed as often as it fires", () => {
    const health = baseline({
      injections: 100,
      categories: [{ ...measured, suppressed: 15 }],
    });
    expect(opportunities(health).join("\n")).toContain("suppressed as often as it fires");
  });

  it("flags ask outcomes", () => {
    const health = baseline();
    health.byOutcome.ask = 3;
    expect(opportunities(health).join("\n")).toContain("ask outcomes");
  });

  it("flags slow silent runs", () => {
    const health = baseline();
    health.latency.silentP95 = 250;
    expect(opportunities(health).join("\n")).toContain("p95 latency");
  });

  it("flags a scratch-skip share above the ceiling", () => {
    const health = baseline();
    health.byOutcome["skipped-scratch"] = Math.round(health.total * 0.7);
    expect(opportunities(health).join("\n")).toContain("skipped-scratch");
  });

  it("reports acceptance as unmeasurable rather than printing a rate", () => {
    const found = opportunities(
      baseline({ categories: [{ ...measured, revisited: 0, accepted: 0 }] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("not measurable yet");
    expect(found[0]).toContain("Keep the log on");
  });

  it("flags a rule acted on less than half the time", () => {
    const health = baseline({ categories: [{ ...measured, revisited: 30, accepted: 9 }] });
    expect(opportunities(health).join("\n")).toContain("acted on after 9 of 30");
  });

  it("points at the log retirement trigger when nothing is raised", () => {
    const found = opportunities(baseline());
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("WRITING_HOOKS_LOG");
  });
});

describe("renderReport", () => {
  test("renders tables and the opportunity list", () => {
    const health = summarize(
      daysApart(
        [
          ...Array.from({ length: 60 }, () => entry()),
          entry({ outcome: "context", category: "numbering", duration_ms: 12 }),
        ],
        7,
      ),
    );
    const report = renderReport(health);
    expect(report).toContain("runs/day");
    expect(report).toContain("numbering");
    expect(report).toContain("Opportunities:");
  });

  test("marks a rule with no closed pair n/a and prints the ratio once one closes", () => {
    const unmeasured = summarize([entry({ outcome: "context", category: "numbering" })]);
    expect(renderReport(unmeasured)).toContain("n/a");

    const measured = summarize([
      entry({ outcome: "context", category: "numbering", target: "f1" }),
      entry({ ts: "2026-07-01T00:01:00.000Z", target: "f1", categories: [] }),
    ]);
    expect(renderReport(measured)).toContain("1/1 100%");
  });
});
