import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStatusLine,
  dialColor,
  dialIndex,
  dialSegment,
  elideSpans,
  emitRateLimits,
  exceeds200k,
  formatWorktree,
  type Span,
  type WorktreeData,
} from "./statusline";

// Strip ANSI SGR and OSC 8 sequences so unit assertions read against the visible
// glyphs rather than the escape wrappers.
function strip(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

interface RenderCase {
  name: string;
  columns: number;
  stdin: Parameters<typeof buildStatusLine>[0];
  worktree: WorktreeData | null;
}

const mainWt: WorktreeData = {
  branch: "main",
  path: "/Users/ben/src/myrepo",
  isMain: true,
  ciUrl: null,
  repoUrl: null,
  ahead: 0,
};

const redundantWt: WorktreeData = {
  branch: "worktree-abc123",
  path: "/Users/ben/src/abc123.worktree-abc123",
  isMain: false,
  ciUrl: null,
  repoUrl: null,
  ahead: 0,
};

function featureWt(ahead: number): WorktreeData {
  return {
    branch: "feature/long-branch-name-that-needs-eliding-eventually",
    path: "/Users/ben/src/myrepo",
    isMain: false,
    ciUrl: "https://github.com/ben/myrepo/actions/runs/1",
    repoUrl: "https://github.com/ben/myrepo",
    ahead,
  };
}

const cases: RenderCase[] = [
  // Dial ramp and color thresholds.
  ...[0, 39, 40, 64, 65, 79, 80, 100].map((pct) => ({
    name: `dial-${pct}`,
    columns: 80,
    stdin: { context_window: { used_percentage: pct } },
    worktree: null,
  })),
  // exceeds_200k color escalation, driven by live current_usage.
  ...[30, 44, 45, 70].map((pct) => ({
    name: `dial-exceeds-${pct}`,
    columns: 80,
    stdin: {
      context_window: { used_percentage: pct, current_usage: { input_tokens: 250_000 } },
    },
    worktree: null,
  })),
  { name: "no-dial", columns: 80, stdin: {}, worktree: null },
  {
    name: "lines-added",
    columns: 80,
    stdin: { cost: { total_lines_added: 5, total_lines_removed: 0 } },
    worktree: null,
  },
  {
    name: "lines-removed",
    columns: 80,
    stdin: { cost: { total_lines_added: 0, total_lines_removed: 3 } },
    worktree: null,
  },
  {
    name: "lines-both",
    columns: 80,
    stdin: { cost: { total_lines_added: 12, total_lines_removed: 7 } },
    worktree: null,
  },
  // Worktree label across widths: main, feature (elision + ahead), redundancy collapse.
  ...[40, 60, 80, 120].map((columns) => ({
    name: `wt-main-${columns}`,
    columns,
    stdin: {},
    worktree: mainWt,
  })),
  ...[40, 60, 80, 120].map((columns) => ({
    name: `wt-feature-${columns}`,
    columns,
    stdin: {},
    worktree: featureWt(3),
  })),
  { name: "wt-redundant", columns: 80, stdin: {}, worktree: redundantWt },
  // Full layout: dial + lines + worktree sharing the budget.
  ...[40, 60, 80, 120].map((columns) => ({
    name: `combined-${columns}`,
    columns,
    stdin: {
      context_window: { used_percentage: 72 },
      cost: { total_lines_added: 120, total_lines_removed: 45 },
    },
    worktree: featureWt(2),
  })),
];

describe("rendered output", () => {
  test.each(cases)("$name", (c) => {
    expect(buildStatusLine(c.stdin, c.columns, c.worktree)).toMatchSnapshot();
  });
});

describe("dialColor", () => {
  const cases: Array<[number, boolean, ReturnType<typeof dialColor>]> = [
    [0, false, "green"],
    [39, false, "green"],
    [40, false, "yellow"],
    [64, false, "yellow"],
    [65, false, "redBright"],
    [79, false, "redBright"],
    [80, false, "red"],
    [100, false, "red"],
    // exceeds_200k escalates one band, with the boundary at 45; redBright/red are unaffected.
    [30, true, "yellow"],
    [44, true, "yellow"],
    [45, true, "red"],
    [70, true, "redBright"],
    [85, true, "red"],
  ];

  test.each(cases)("dialColor(%i, exceeds=%p) → %s", (pct, exceeds, want) => {
    expect(dialColor(pct, exceeds)).toBe(want);
  });
});

describe("exceeds200k", () => {
  const sumCases: Array<{ name: string; input: Parameters<typeof exceeds200k>[0]; want: boolean }> =
    [
      {
        name: "single field over 200k",
        input: { context_window: { current_usage: { input_tokens: 250_000 } } },
        want: true,
      },
      {
        name: "summed breakdown over 200k",
        input: {
          context_window: {
            current_usage: {
              input_tokens: 100_000,
              cache_read_input_tokens: 90_000,
              output_tokens: 20_000,
            },
          },
        },
        want: true,
      },
      {
        name: "under 200k",
        input: { context_window: { current_usage: { input_tokens: 150_000 } } },
        want: false,
      },
      { name: "no current_usage", input: { context_window: {} }, want: false },
      { name: "no context_window", input: {}, want: false },
    ];

  test.each(sumCases)("sums the live current_usage token breakdown: $name", ({ input, want }) => {
    expect(exceeds200k(input)).toBe(want);
  });

  test("color de-escalates with position after compaction shrinks the context", () => {
    // Before compaction: large context, escalated color.
    const before = dialSegment({
      context_window: { used_percentage: 85, current_usage: { input_tokens: 850_000 } },
    });
    // After compaction: used_percentage drops and current_usage shrinks together,
    // so both the glyph (position) and its color reset.
    const after = dialSegment({
      context_window: { used_percentage: 10, current_usage: { input_tokens: 100_000 } },
    });
    expect(strip(before ?? "")).not.toBe(strip(after ?? ""));
    // The post-compaction dial uses the un-escalated color for its low percentage.
    expect(after).toBe(dialSegment({ context_window: { used_percentage: 10 } }));
  });
});

describe("dialIndex", () => {
  test.each([
    [0, 0],
    [39, 2],
    [50, 3],
    [100, 7],
    [120, 7], // capped
  ])("dialIndex(%i) → %i", (pct, want) => {
    expect(dialIndex(pct)).toBe(want);
  });
});

describe("elideSpans", () => {
  const span = (text: string, pre = "", suf = ""): Span => ({ text, pre, suf });

  test("fits within budget returns all spans wrapped", () => {
    const out = elideSpans([span("ab", "<", ">"), span("cd")], 10);
    expect(out).toBe("<ab>cd");
  });

  test("single span middle-elide", () => {
    const out = elideSpans([span("abcdefghij")], 5);
    expect(strip(out)).toBe("ab…ij");
  });

  test("preserves wrappers around surviving pieces", () => {
    const out = elideSpans([span("aaaa", "[", "]"), span("bbbb", "{", "}")], 5);
    // head=2 -> "aa" from first span; tail=2 -> "bb" from last span
    expect(out).toBe("[aa]{…bb}");
  });

  test("multi-byte branch elides on codepoint boundaries", () => {
    const out = elideSpans([span("日本語のブランチ名前")], 5);
    expect(strip(out)).toBe("日本…名前");
  });
});

describe("formatWorktree redundancy collapse", () => {
  const base: WorktreeData = {
    branch: "",
    path: "",
    isMain: false,
    ciUrl: null,
    repoUrl: null,
    ahead: 0,
  };

  test("branch carrying repo as suffix shows branch alone", () => {
    const out = formatWorktree(
      { ...base, branch: "worktree-abc123", path: "/x/abc123.worktree-abc123" },
      80,
    );
    expect(strip(out.join("  "))).toBe("worktree-abc123");
  });

  test("independent repo and branch shows repo/branch", () => {
    const out = formatWorktree({ ...base, branch: "feature/x", path: "/x/myrepo" }, 80);
    expect(strip(out.join("  "))).toBe("myrepo/feature/x");
  });

  test("main shows repo alone", () => {
    const out = formatWorktree({ ...base, isMain: true, branch: "main", path: "/x/myrepo" }, 80);
    expect(strip(out.join("  "))).toBe("myrepo");
  });

  test("ahead segment reserved and appended", () => {
    const out = formatWorktree(
      { ...base, isMain: true, branch: "main", path: "/x/myrepo", ahead: 4 },
      80,
    );
    expect(out.map(strip)).toEqual(["myrepo", "↑4"]);
  });

  test("budget too small drops the label, keeps ahead segment", () => {
    const out = formatWorktree(
      { ...base, isMain: true, branch: "main", path: "/x/myrepo", ahead: 5 },
      4,
    );
    expect(out.map(strip)).toEqual(["↑5"]);
  });

  test("budget too small with no ahead yields nothing", () => {
    const out = formatWorktree({ ...base, isMain: true, branch: "main", path: "/x/myrepo" }, 2);
    expect(out).toEqual([]);
  });
});

describe("emitRateLimits", () => {
  const limits = {
    five_hour: { used_percentage: 0, resets_at: 1780524600 },
    seven_day: { used_percentage: 33, resets_at: 1780898400 },
  };

  test("writes rate_limits to a nested path, creating dirs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rl-"));
    try {
      const target = join(dir, "nested", "rl.json");
      await emitRateLimits({ rate_limits: limits }, target);
      expect(await Bun.file(target).json()).toEqual(limits);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no rate_limits is a no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rl-"));
    try {
      const target = join(dir, "rl.json");
      await emitRateLimits({}, target);
      expect(await Bun.file(target).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
