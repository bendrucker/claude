import { describe, expect, test } from "bun:test";
import { styleText } from "node:util";
import { genericGlyph, purposeGlyphs } from "./glyphs";
import {
  formatDescription,
  formatElapsed,
  formatTokens,
  renderTask,
  type Task,
} from "./subagent-statusline";

function strip(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

describe("formatElapsed", () => {
  test.each([
    [0, 65_000, "1m 5s"],
    [0, 0, "0m 0s"],
    [10_000, 130_000, "2m 0s"],
    [0, 3_661_000, "61m 1s"],
  ])("formatElapsed(%i, %i) → %s", (start, now, want) => {
    expect(formatElapsed(start, now)).toBe(want);
  });
});

describe("formatTokens", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1000, "1.0k"],
    [1500, "1.5k"],
    [12_340, "12.3k"],
  ])("formatTokens(%i) → %s", (n, want) => {
    expect(formatTokens(n)).toBe(want);
  });
});

describe("formatDescription", () => {
  test("strips the agent-type prefix and sentence-cases the rest", () => {
    expect(formatDescription("Plan: review:self comprehension variant", "Plan")).toBe(
      "Review:self comprehension variant",
    );
    expect(formatDescription("Plan: worktree hook escape hatch", "Plan")).toBe(
      "Worktree hook escape hatch",
    );
  });

  test("sentence-cases even when no prefix is present", () => {
    expect(formatDescription("search the parser", "Explore")).toBe("Search the parser");
    expect(formatDescription("deploy to prod", null)).toBe("Deploy to prod");
  });

  test("only strips a leading prefix matching the agent type", () => {
    expect(formatDescription("review:self comprehension variant", "Plan")).toBe(
      "Review:self comprehension variant",
    );
  });
});

describe("renderTask", () => {
  const now = 65_000;

  test("dims the in-progress gray glyph; finished green/red stay vivid", () => {
    expect(renderTask({ id: "a", status: "running" }, null, now, null).content).toContain(
      styleText(["gray", "dim"], genericGlyph),
    );
    expect(renderTask({ id: "a", status: "completed" }, null, now, null).content).toContain(
      styleText("green", genericGlyph),
    );
    expect(renderTask({ id: "a", status: "failed" }, null, now, null).content).toContain(
      styleText("red", genericGlyph),
    );
  });

  test("text falls back name then agent", () => {
    expect(strip(renderTask({ id: "a", name: "builder" }, null, now, null).content)).toContain(
      "builder",
    );
    expect(strip(renderTask({ id: "a" }, null, now, null).content)).toContain("agent");
  });

  test("description preferred over name", () => {
    const out = renderTask({ id: "a", description: "do thing", name: "builder" }, null, now, null);
    expect(strip(out.content)).toContain("Do thing");
    expect(strip(out.content)).not.toContain("builder");
  });

  test("type glyph from agent type, generic fallback when untyped", () => {
    const explore = strip(renderTask({ id: "a", name: "x" }, null, now, "Explore").content);
    expect(explore).toContain(purposeGlyphs.get("Explore") ?? "");
    expect(explore).not.toContain(genericGlyph);
    const untyped = strip(renderTask({ id: "a", name: "x" }, null, now, "general-purpose").content);
    expect(untyped).toContain(genericGlyph);
    expect(untyped).not.toContain(purposeGlyphs.get("Explore") ?? "");
  });

  test("remote marker only for remote_agent", () => {
    const remote = strip(
      renderTask({ id: "a", name: "x", type: "remote_agent" }, null, now, null).content,
    );
    expect(remote).toContain(String.fromCodePoint(0xf0c2));
    const local = strip(
      renderTask({ id: "a", name: "x", type: "local_agent" }, null, now, null).content,
    );
    expect(local).not.toContain(String.fromCodePoint(0xf0c2));
  });

  test("meta combines elapsed and tokens", () => {
    const out = renderTask({ id: "a", name: "x", startTime: 0, tokenCount: 1500 }, null, now, null);
    expect(strip(out.content)).toContain("· 1m 5s · 1.5k");
  });

  test("type name trails after the meta as dim text", () => {
    const out = renderTask(
      { id: "a", description: "search", startTime: 0, tokenCount: 1500 },
      null,
      now,
      "Explore",
    );
    expect(strip(out.content)).toContain("· 1m 5s · 1.5k · Explore");
    expect(out.content).toContain(styleText(["dim"], "· 1m 5s · 1.5k · Explore"));
  });

  test("type name drops on narrow terminals while the description survives", () => {
    const out = renderTask({ id: "a", description: "search the parser" }, 24, now, "Explore");
    expect(Bun.stringWidth(out.content)).toBeLessThanOrEqual(24);
    expect(strip(out.content)).toContain("Search the parser");
    expect(strip(out.content)).not.toContain("Explore");
  });

  test("truncates text to columns", () => {
    const out = renderTask({ id: "a", description: "x".repeat(80) }, 20, now, null);
    expect(Bun.stringWidth(out.content)).toBeLessThanOrEqual(20);
    expect(strip(out.content)).toContain("…");
  });

  test("truncates wide-character text within the column budget", () => {
    const out = renderTask({ id: "a", description: "🚀".repeat(10) }, 12, now, null);
    expect(Bun.stringWidth(out.content)).toBeLessThanOrEqual(12);
    expect(strip(out.content)).toContain("…");
  });

  test("id passes through", () => {
    expect(renderTask({ id: "task-7", name: "x" }, null, now, null).id).toBe("task-7");
  });
});

describe("rendered content", () => {
  const now = 65_000;

  const cases: Array<{
    name: string;
    task: Task;
    columns: number | null;
    agentType: string | null;
  }> = [
    {
      name: "running",
      task: { id: "a", name: "builder", status: "running" },
      columns: null,
      agentType: null,
    },
    {
      name: "completed-tokens",
      task: { id: "a", description: "deploy to prod", status: "completed", tokenCount: 1500 },
      columns: null,
      agentType: null,
    },
    {
      name: "failed",
      task: { id: "a", name: "reviewer", status: "failed" },
      columns: null,
      agentType: null,
    },
    {
      name: "remote",
      task: { id: "a", description: "remote build", status: "running", type: "remote_agent" },
      columns: null,
      agentType: null,
    },
    {
      name: "explore-glyph",
      task: { id: "a", description: "search", status: "running" },
      columns: null,
      agentType: "Explore",
    },
    {
      name: "plan-glyph",
      task: { id: "a", description: "design", status: "running" },
      columns: null,
      agentType: "Plan",
    },
    {
      name: "guide-glyph",
      task: { id: "a", description: "docs", status: "running" },
      columns: null,
      agentType: "claude-code-guide",
    },
    {
      name: "full-meta-remote-explore",
      task: {
        id: "a",
        description: "build the parser",
        status: "running",
        type: "remote_agent",
        startTime: 0,
        tokenCount: 2300,
      },
      columns: null,
      agentType: "Explore",
    },
    {
      name: "truncated",
      task: { id: "a", description: "a really long description that overflows", status: "running" },
      columns: 30,
      agentType: null,
    },
  ];

  test.each(cases)("$name", (c) => {
    expect(renderTask(c.task, c.columns, now, c.agentType).content).toMatchSnapshot();
  });
});
