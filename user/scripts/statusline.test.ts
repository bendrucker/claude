import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachePath, type ContextToken, titleCachePath } from "./pane-metadata";
import {
  buildStatusLine,
  contextDial,
  dialColor,
  dialIndex,
  dialSegment,
  effortSegment,
  elideSpans,
  emitRateLimits,
  exceeds200k,
  formatWorktree,
  modelSegment,
  type Span,
  type WorktreeData,
} from "./statusline";

// Strip ANSI SGR and OSC 8 sequences so unit assertions read against the visible
// glyphs rather than the escape wrappers.
function strip(s: string): string {
  // oxlint-disable-next-line no-control-regex
  return s.replaceAll(/\x1b\[[0-9;]*m/g, "").replaceAll(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
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
    name: "model-effort-leads",
    columns: 80,
    stdin: {
      model: { id: "claude-fable-5", display_name: "Fable" },
      effort: { level: "xhigh" },
      context_window: { used_percentage: 30 },
    },
    worktree: mainWt,
  },
  {
    name: "model-only",
    columns: 80,
    stdin: { model: { id: "claude-opus-4-8", display_name: "Opus" } },
    worktree: null,
  },
  {
    name: "effort-only",
    columns: 80,
    stdin: { effort: { level: "max" } },
    worktree: null,
  },
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

// SGR fragments the accent (magenta) and default (dim) styles emit, so tests can
// assert which style a marker used without matching the whole escape sequence.
const MAGENTA = "\x1b[35m";
const DIM = "\x1b[2m";

describe("modelSegment", () => {
  test("renders the lowercase family letter, null when absent", () => {
    expect(strip(modelSegment({ model: { id: "claude-fable-5" } }) ?? "")).toBe("f");
    expect(strip(modelSegment({ model: { id: "claude-opus-4-8[1m]" } }) ?? "")).toBe("o");
    expect(modelSegment({})).toBeNull();
    expect(modelSegment({ model: null })).toBeNull();
  });

  test("accents non-default models, dims the default (opus)", () => {
    expect(modelSegment({ model: { id: "claude-opus-4-8[1m]" } })).toContain(DIM);
    expect(modelSegment({ model: { id: "claude-fable-5" } })).toContain(MAGENTA);
    expect(modelSegment({ model: { id: "claude-sonnet-5" } })).toContain(MAGENTA);
  });
});

describe("effortSegment", () => {
  test("renders the effort glyph, null when absent or unsupported", () => {
    expect(strip(effortSegment({ effort: { level: "max" } }) ?? "")).toBe("⁙");
    expect(strip(effortSegment({ effort: { level: "low" } }) ?? "")).toBe("∙");
    expect(effortSegment({ effort: { level: "bogus" } })).toBeNull();
    expect(effortSegment({})).toBeNull();
    expect(effortSegment({ effort: null })).toBeNull();
  });

  test("accents non-default effort, dims the default (high)", () => {
    expect(effortSegment({ effort: { level: "high" } })).toContain(DIM);
    expect(effortSegment({ effort: { level: "max" } })).toContain(MAGENTA);
    expect(effortSegment({ effort: { level: "low" } })).toContain(MAGENTA);
  });
});

describe("dialColor", () => {
  test("thresholds", () => {
    expect(dialColor(0, false)).toBe("green");
    expect(dialColor(39, false)).toBe("green");
    expect(dialColor(40, false)).toBe("yellow");
    expect(dialColor(64, false)).toBe("yellow");
    expect(dialColor(65, false)).toBe("redBright");
    expect(dialColor(79, false)).toBe("redBright");
    expect(dialColor(80, false)).toBe("red");
    expect(dialColor(100, false)).toBe("red");
  });

  test("exceeds_200k escalation", () => {
    expect(dialColor(30, true)).toBe("yellow"); // green -> yellow
    expect(dialColor(44, true)).toBe("yellow"); // yellow stays (< 45)
    expect(dialColor(45, true)).toBe("red"); // yellow -> red (>= 45)
    expect(dialColor(70, true)).toBe("redBright"); // redBright unaffected
    expect(dialColor(85, true)).toBe("red"); // red unaffected
  });
});

describe("exceeds200k", () => {
  test("sums the live current_usage token breakdown", () => {
    expect(exceeds200k({ context_window: { current_usage: { input_tokens: 250_000 } } })).toBe(
      true,
    );
    expect(
      exceeds200k({
        context_window: {
          current_usage: {
            input_tokens: 100_000,
            cache_read_input_tokens: 90_000,
            output_tokens: 20_000,
          },
        },
      }),
    ).toBe(true);
    expect(exceeds200k({ context_window: { current_usage: { input_tokens: 150_000 } } })).toBe(
      false,
    );
    expect(exceeds200k({ context_window: {} })).toBe(false);
    expect(exceeds200k({})).toBe(false);
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

describe("contextDial", () => {
  test.each<[number, ContextToken]>([
    [0, "ctx_low"],
    [39, "ctx_low"],
    [40, "ctx_mid"],
    [64, "ctx_mid"],
    [65, "ctx_high"],
    [79, "ctx_high"],
    [80, "ctx_crit"],
    [100, "ctx_crit"],
  ])("%i%% reports %s", (pct, token) => {
    const input = { context_window: { used_percentage: pct } };
    // The sidebar shows the same glyph the status line renders, minus the color.
    expect(contextDial(input)).toEqual({ token, value: strip(dialSegment(input) ?? "") });
  });

  test("carries the exceeds_200k escalation the rendered dial uses", () => {
    const input = {
      context_window: { used_percentage: 30, current_usage: { input_tokens: 250_000 } },
    };
    expect(contextDial(input)?.token).toBe("ctx_mid");
    expect(contextDial({ context_window: { used_percentage: 30 } })?.token).toBe("ctx_low");
  });

  test("reports nothing without a percentage", () => {
    expect(contextDial({})).toBeNull();
  });
});

describe("dialIndex", () => {
  test("ramp and cap", () => {
    expect(dialIndex(0)).toBe(0);
    expect(dialIndex(39)).toBe(2);
    expect(dialIndex(50)).toBe(3);
    expect(dialIndex(100)).toBe(7);
    expect(dialIndex(120)).toBe(7); // capped
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

// The dial and the title only mean something once they reach herdr, and the
// chain that carries them (stdin schema, transcript scan, detached child,
// argv) has no seam a unit test can reach. Drive the real script against a
// `herdr` stubbed onto PATH and assert on what the stub recorded.
describe("pane metadata report", () => {
  const sessionId = "9f0b1c2d-3e4f-5061-7283-94a5b6c7d8e9";

  // Derived rather than inlined: a private-use glyph pasted into an assertion is
  // one bad paste away from asserting some other icon.
  const dial = contextDial({ context_window: { used_percentage: 30 } });
  const dialToken = `${dial?.token}=${dial?.value}`;

  const paneList = JSON.stringify({
    result: {
      type: "pane_list",
      panes: [{ pane_id: "w2:p2", agent_session: { agent: "claude", value: sessionId } }],
    },
  });

  async function recordedArgs(transcript: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), "statusline-herdr-"));
    const bin = join(dir, "bin");
    const log = join(dir, "argv");
    const transcriptPath = join(dir, "transcript.jsonl");

    try {
      mkdirSync(bin);
      const herdr = join(bin, "herdr");
      await Bun.write(
        herdr,
        [
          "#!/bin/sh",
          `if [ "$2" = list ]; then printf '%s' '${paneList}'; exit 0; fi`,
          `for arg in "$@"; do printf '%s\\n' "$arg" >> ${log}; done`,
          "",
        ].join("\n"),
      );
      Bun.spawnSync(["chmod", "+x", herdr]);
      await Bun.write(transcriptPath, transcript);

      const child = Bun.spawn([process.execPath, join(import.meta.dir, "statusline.ts")], {
        env: { ...process.env, HERDR_PANE_ID: "w2:p2", PATH: `${bin}:${process.env.PATH ?? ""}` },
        stdin: Buffer.from(
          JSON.stringify({
            session_id: sessionId,
            transcript_path: transcriptPath,
            context_window: { used_percentage: 30 },
          }),
        ),
        stdout: "ignore",
        stderr: "ignore",
      });
      await child.exited;

      // The reporting child is detached so the line renders at its own speed,
      // which lands the stub's log after the status line has already exited.
      // oxlint-disable no-await-in-loop -- polling for another process's write is sequential by nature.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const text = await Bun.file(log)
          .text()
          .catch(() => "");
        if (text.includes("report-metadata")) return text.trimEnd().split("\n");
        await Bun.sleep(25);
      }
      // oxlint-enable no-await-in-loop
      return [];
    } finally {
      await Promise.all([
        rm(dir, { recursive: true, force: true }),
        rm(cachePath(sessionId), { force: true }),
        rm(titleCachePath(sessionId), { force: true }),
      ]);
    }
  }

  test("carries the title token and the dial to herdr", async () => {
    const args = await recordedArgs(
      `${JSON.stringify({ type: "ai-title", aiTitle: "Herdr sidebar redesign", sessionId })}\n`,
    );
    const tokens = args.filter((_arg, i) => args[i - 1] === "--token");
    expect(tokens).toEqual(["title=Herdr sidebar redesign", dialToken]);
  });

  test("clears the title before the session is named", async () => {
    const args = await recordedArgs(
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })}\n`,
    );
    const tokens = args.filter((_arg, i) => args[i - 1] === "--token");
    expect(tokens).toEqual([dialToken]);
    expect(args.filter((_arg, i) => args[i - 1] === "--clear-token")).toContain("title");
  });
});
