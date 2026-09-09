import { describe, expect, test } from "bun:test";
import { audit, readBashCalls, verdict } from "./audit";

function calls(specs: { command: string; ms: number; day?: string }[]) {
  return specs.map(({ command, ms, day }) => ({ command, ms, day: day ?? "2026-09-01" }));
}

describe("audit", () => {
  test("counts only the commands the matcher denies", () => {
    const result = audit(
      calls([
        { command: "find / -name x", ms: 90_000 },
        { command: "find ./src -name x", ms: 200 },
        { command: "ls -la", ms: 50 },
      ]),
    );

    expect(result.scanned).toBe(3);
    expect(result.denied).toBe(1);
    expect(result.minutesSaved).toBeCloseTo(1.5, 1);
  });

  test("projects the fire rate over the days the corpus spans", () => {
    const result = audit(
      calls([
        { command: "find / -name a", ms: 90_000, day: "2026-09-01" },
        { command: "find / -name b", ms: 90_000, day: "2026-09-02" },
      ]),
    );

    expect(result.perMonth).toBe(30);
  });

  test("ignores calls with no recorded duration when measuring precision", () => {
    const result = audit(
      calls([
        { command: "find / -name a", ms: -1 },
        { command: "find / -name b", ms: 500 },
      ]),
    );

    expect(result.denied).toBe(2);
    expect(result.underTwoSeconds).toBe(1);
    expect(result.fastShare).toBe(1);
  });

  test("reports zeroes rather than dividing by zero on an empty corpus", () => {
    const result = audit([]);

    expect(result.perMonth).toBe(0);
    expect(result.fastShare).toBe(0);
    expect(result.medianMs).toBe(0);
  });
});

describe("verdict", () => {
  const base = {
    scanned: 100_000,
    denied: 60,
    perMonth: 57,
    medianMs: 85_000,
    underTwoSeconds: 3,
    fastShare: 0.05,
    minutesSaved: 300,
  };

  test("keeps the hook while it fires often and stays precise", () => {
    expect(verdict(base)).toContain("KEEP");
  });

  test("retires the hook once the behavior stops", () => {
    expect(verdict({ ...base, perMonth: 14 })).toContain("RETIRE");
  });

  test("narrows the hook when scoped searches start getting caught", () => {
    expect(verdict({ ...base, fastShare: 0.11 })).toContain("NARROW");
  });

  test("retirement outranks narrowing when the hook has gone quiet", () => {
    expect(verdict({ ...base, perMonth: 2, fastShare: 0.5 })).toContain("RETIRE");
  });
});

describe("readBashCalls", () => {
  test.each(["2026-9-9", "yesterday", "2026-01-01'; DROP TABLE tool_calls; --"])(
    "refuses %p before it reaches the query",
    (since) => {
      expect(() => readBashCalls(since)).toThrow("--since expects a YYYY-MM-DD date");
    },
  );
});
