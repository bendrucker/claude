import { describe, expect, it, test } from "bun:test";
import type { RunLogEntry } from "../../../hooks/run-log";
import { type Acceptance, acceptance, parseLog, renderReport, summarize } from "./hook-health";

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

describe("parseLog", () => {
  it("reads one entry per line and skips torn writes", () => {
    const text = [
      JSON.stringify(entry()),
      '{"ts":"2026-07-01T00:00:00.000Z","session_id":"s1","tool":"Wr',
      "",
      JSON.stringify(entry({ outcome: "context", check: "numbering" })),
    ].join("\n");
    const entries = parseLog(text);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.check).toBe("numbering");
  });

  it("reads the category keys entries carried before the Vale port", () => {
    const { check: _, ...base } = entry();
    const legacy = {
      ...base,
      category: "numbering",
      categories: ["numbering"],
      suppressed_categories: [],
    };
    expect(parseLog(JSON.stringify(legacy))[0]).toMatchObject({
      check: "numbering",
      checks: ["numbering"],
      suppressed_checks: [],
    });
  });
});

describe("summarize", () => {
  it("aggregates outcomes, per-check fires, and latency", () => {
    const health = summarize([
      entry({ duration_ms: 2 }),
      entry({ duration_ms: 4, tool: "Bash", ext: "" }),
      entry({ outcome: "context", check: "numbering", duration_ms: 10 }),
      entry({ outcome: "silent", check: "numbering", suppressed: true, duration_ms: 1 }),
      entry({ outcome: "deny", check: "spaced em dash", duration_ms: 20 }),
      entry({ outcome: "context", emitted: ["filler", "spaced em dash"], duration_ms: 8 }),
    ]);
    expect(health).toMatchInlineSnapshot(`
      {
        "byOutcome": {
          "ask": 0,
          "context": 2,
          "deny": 1,
          "error": 0,
          "silent": 3,
          "skipped-scratch": 0,
        },
        "checks": [
          {
            "accepted": 0,
            "check": "spaced em dash",
            "fired": 2,
            "revisited": 0,
            "unconfirmed": 0,
          },
          {
            "accepted": 0,
            "check": "numbering",
            "fired": 1,
            "revisited": 0,
            "unconfirmed": 0,
          },
          {
            "accepted": 0,
            "check": "filler",
            "fired": 1,
            "revisited": 0,
            "unconfirmed": 0,
          },
        ],
        "latency": {
          "p50": 4,
          "p95": 20,
          "silentP95": 4,
        },
        "total": 6,
      }
    `);
  });
});

describe("acceptance", () => {
  function shown(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
    return entry({ outcome: "context", check: "numbering", target: "f1", ...overrides });
  }

  const actedOn: Acceptance = { revisited: 1, accepted: 1, unconfirmed: 0 };
  const writtenPast: Acceptance = { revisited: 1, accepted: 0, unconfirmed: 0 };
  const undecided: Acceptance = { revisited: 0, accepted: 0, unconfirmed: 1 };

  test.each<{ name: string; entries: RunLogEntry[]; expected: Record<string, Acceptance> }>([
    {
      name: "a whole-file re-scan that no longer raises the rule counts as acted on",
      entries: [shown(), entry({ target: "f1", checks: [] })],
      expected: { numbering: actedOn },
    },
    {
      name: "a whole-file re-scan that still raises the rule counts as written past",
      entries: [shown(), entry({ target: "f1", checks: ["numbering"] })],
      expected: { numbering: writtenPast },
    },
    {
      name: "a re-scan pairs even when it ranked a different check first",
      entries: [
        shown(),
        entry({
          outcome: "deny",
          check: "spaced em dash",
          target: "f1",
          checks: ["numbering"],
        }),
      ],
      expected: { numbering: writtenPast, "spaced em dash": undecided },
    },
    {
      name: "a hunk-scoped edit's silence decides nothing",
      entries: [shown(), entry({ tool: "Edit", target: "f1", checks: [] })],
      expected: { numbering: undecided },
    },
    {
      // Before the PostToolUse move, an edit reported only the hits its own hunk introduced.
      name: "a hunk-scoped edit that raises the rule again decides nothing",
      entries: [shown(), entry({ tool: "Edit", target: "f1", checks: ["numbering"] })],
      expected: { numbering: undecided },
    },
    {
      name: "a whole-file re-scan decides past a silent hunk edit",
      entries: [
        shown(),
        entry({ tool: "Edit", target: "f1", checks: [] }),
        entry({ tool: "Write", target: "f1", checks: [] }),
      ],
      expected: { numbering: actedOn },
    },
    {
      name: "a whole-file re-scan decides past a hunk edit that raised the rule",
      entries: [
        shown(),
        entry({ tool: "Edit", target: "f1", checks: ["numbering"] }),
        entry({ tool: "Write", target: "f1", checks: [] }),
      ],
      expected: { numbering: actedOn },
    },
    {
      name: "a PostToolUse edit re-lints the whole file and decides",
      entries: [shown(), entry({ event: "PostToolUse", tool: "Edit", target: "f1", checks: [] })],
      expected: { numbering: actedOn },
    },
    {
      name: "a PostToolUse edit that still raises the rule counts as written past",
      entries: [
        shown(),
        entry({ event: "PostToolUse", tool: "Edit", target: "f1", checks: ["numbering"] }),
      ],
      expected: { numbering: writtenPast },
    },
    {
      name: "a finding nothing followed stays counted as unconfirmed",
      entries: [shown()],
      expected: { numbering: undecided },
    },
    {
      name: "a run that returned before the checkers leaves the finding unconfirmed",
      entries: [shown(), entry({ target: "f1", outcome: "skipped-scratch" })],
      expected: { numbering: undecided },
    },
    {
      name: "a whole-file run that returned before the checkers decides nothing",
      entries: [shown(), entry({ tool: "Write", target: "f1", outcome: "skipped-scratch" })],
      expected: { numbering: undecided },
    },
    {
      name: "pairing stays within one session and one file",
      entries: [
        shown(),
        entry({ target: "f2", checks: [] }),
        entry({ session_id: "s2", target: "f1", checks: [] }),
      ],
      expected: { numbering: undecided },
    },
    {
      name: "a suppressed finding seeds no pair",
      entries: [
        shown({ outcome: "silent", suppressed: true }),
        entry({ target: "f1", checks: [] }),
      ],
      expected: {},
    },
    {
      name: "every emitted check of one run pairs with the re-scan",
      entries: [
        shown({ emitted: ["numbering", "filler"] }),
        entry({ target: "f1", checks: ["filler"] }),
      ],
      expected: { numbering: actedOn, filler: writtenPast },
    },
    {
      name: "entries logged before targets were recorded are ignored",
      entries: [entry({ outcome: "context", check: "numbering" }), entry({ checks: [] })],
      expected: {},
    },
  ])("$name", ({ entries, expected }) => {
    expect(Object.fromEntries(acceptance(entries))).toEqual(expected);
  });
});

describe("renderReport", () => {
  test("marks a check with no closed pair n/a and prints the ratio once one closes", () => {
    const report = renderReport(
      summarize([
        entry({ outcome: "context", check: "numbering" }),
        entry({ outcome: "context", check: "filler", target: "f1" }),
        entry({ ts: "2026-07-01T00:01:00.000Z", target: "f1", checks: [] }),
      ]),
    );
    expect(report).toMatchInlineSnapshot(`
      "╔══════════════╤══════════════════════════╗
      ║ runs         │ 3                        ║
      ╟──────────────┼──────────────────────────╢
      ║ outcomes     │ silent=1 context=2       ║
      ╟──────────────┼──────────────────────────╢
      ║ latency (ms) │ p50=5 p95=5 silent-p95=5 ║
      ╚══════════════╧══════════════════════════╝

      ╔═══════════╤═══════╤══════════╤═════════════╗
      ║ check     │ fired │ acted on │ unconfirmed ║
      ╟───────────┼───────┼──────────┼─────────────╢
      ║ numbering │ 1     │ n/a      │ 0           ║
      ╟───────────┼───────┼──────────┼─────────────╢
      ║ filler    │ 1     │ 1/1 100% │ 0           ║
      ╚═══════════╧═══════╧══════════╧═════════════╝
      "
    `);
  });
});
