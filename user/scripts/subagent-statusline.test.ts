import { describe, expect, test } from "bun:test";
import { genericGlyph, purposeGlyphs } from "./glyphs";
import { styleText } from "./style";
import {
  extractActivity,
  extractModel,
  formatDescription,
  formatElapsed,
  formatTokens,
  humanizeTool,
  renderTask,
  subagentModelLetter,
  type Task,
} from "./subagent-statusline";

function strip(s: string): string {
  // stripping terminal escapes
  // oxlint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

describe("formatElapsed", () => {
  test("minutes and seconds", () => {
    expect(formatElapsed(0, 65_000)).toBe("1m 5s");
    expect(formatElapsed(0, 0)).toBe("0m 0s");
    expect(formatElapsed(10_000, 130_000)).toBe("2m 0s");
    expect(formatElapsed(0, 3_661_000)).toBe("61m 1s");
  });
});

describe("formatTokens", () => {
  test("integer below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
  test("thousands with one decimal", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(12_340)).toBe("12.3k");
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

describe("humanizeTool", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["Read", { file_path: "/a/b/extract.ts" }, "Reading extract.ts"],
    ["Edit", { file_path: "/a/b/diff.ts" }, "Editing diff.ts"],
    ["MultiEdit", { file_path: "/a/b/diff.ts" }, "Editing diff.ts"],
    ["Write", { file_path: "/a/b/prompt.md" }, "Writing prompt.md"],
    ["Bash", { command: "ssh -o ControlPath=x host 'grep foo'" }, "Running ssh"],
    ["Bash", { command: "  grep -A 3 bar baz" }, "Running grep"],
    ["Grep", { pattern: "needle" }, "Searching needle"],
    ["Glob", { pattern: "**/*.ts" }, "Globbing **/*.ts"],
    ["ToolSearch", {}, "Searching tools"],
    ["WebFetch", { url: "https://example.com/docs/page" }, "Fetching page"],
    ["SendMessage", { to: "a77b", summary: "Redirect lake agent" }, "→ Redirect lake agent"],
    ["SendMessage", {}, "→ message"],
    ["Task", { description: "design the api" }, "Spawning design the api"],
    ["TodoWrite", {}, "Updating todos"],
    ["Skill", { skill: "writing:writing" }, "Running /writing:writing"],
    ["MysteryTool", {}, "MysteryTool"],
    ["Read", { file_path: { path: "/a/b.ts" } }, "Reading "],
    ["Grep", { pattern: {} }, "Searching"],
    ["Grep", { query: "needle" }, "Searching needle"],
    ["SendMessage", { summary: { text: "hi" } }, "→ message"],
    ["Task", { description: [] }, "Spawning agent"],
  ];

  test.each(cases)("%s %o -> %s", (name, input, expected) => {
    expect(humanizeTool(name, input)).toBe(expected);
  });
});

describe("extractActivity", () => {
  const assistant = (...content: object[]) => ({ message: { role: "assistant", content } });

  test("returns the latest tool call when the last assistant turn ends mid-call", () => {
    const entries = [
      assistant({ type: "text", text: "Let me check" }),
      assistant(
        { type: "text", text: "Now run it" },
        { type: "tool_use", name: "Bash", input: { command: "bun test" } },
      ),
      { message: { role: "user", content: [{ type: "tool_result" }] } },
    ];
    expect(extractActivity(entries)).toBe("Running bun");
  });

  test("returns the latest assistant line when the teammate is narrating", () => {
    const entries = [
      assistant({ type: "tool_use", name: "Read", input: { file_path: "/x/y.ts" } }),
      { message: { role: "user", content: [{ type: "tool_result" }] } },
      assistant({ type: "text", text: "14 fixtures delivered\nspanning 6 categories" }),
    ];
    expect(extractActivity(entries)).toBe("14 fixtures delivered spanning 6 categories");
  });

  test("skips empty text and non-assistant entries", () => {
    const entries = [
      assistant({ type: "tool_use", name: "ToolSearch", input: {} }),
      assistant({ type: "text", text: "   " }),
    ];
    expect(extractActivity(entries)).toBe("Searching tools");
  });

  test("returns null when there is no tool or text event", () => {
    expect(extractActivity([])).toBeNull();
    expect(
      extractActivity([{ message: { role: "assistant", content: [{ type: "thinking" }] } }]),
    ).toBeNull();
  });
});

describe("extractModel", () => {
  const withModel = (model?: string) => {
    const message: { role: string; content: never[]; model?: string } = {
      role: "assistant",
      content: [],
    };
    if (model) message.model = model;
    return { message };
  };

  test("returns the newest assistant model", () => {
    expect(extractModel([withModel("claude-opus-4-8"), withModel("claude-fable-5")])).toBe(
      "claude-fable-5",
    );
  });

  test("skips entries without a model", () => {
    expect(extractModel([withModel("claude-opus-4-8"), withModel(undefined)])).toBe(
      "claude-opus-4-8",
    );
  });

  test("null when no entry carries a model", () => {
    expect(extractModel([])).toBeNull();
    expect(extractModel([withModel(undefined)])).toBeNull();
  });
});

describe("subagentModelLetter", () => {
  test.each<[string | null, string | null, string | null]>([
    ["claude-fable-5", "claude-opus-4-8", "f"],
    ["claude-opus-4-8", "claude-opus-4-8", null],
    ["claude-opus-4-8[1m]", "claude-opus-4-8", null],
    ["claude-opus-4-8", "claude-fable-5", "o"],
    [null, "claude-opus-4-8", null],
    ["claude-fable-5", null, null],
  ])("sub %p / session %p -> %p", (sub, session, expected) => {
    expect(subagentModelLetter(sub, session)).toBe(expected);
  });
});

describe("renderTask", () => {
  const now = 65_000;

  test("model letter joins the dim meta before the type name", () => {
    const out = renderTask(
      { id: "a", description: "search", startTime: 0, tokenCount: 1500 },
      null,
      now,
      "Explore",
      null,
      null,
      "f",
    );
    expect(strip(out.content)).toContain("· 1m 5s · 1.5k · f · Explore");
  });

  test.each<[string | number, string]>([
    ["low", "· 1m 5s · ∙"],
    ["max", "· 1m 5s · ⁙"],
    [20_000, "· 1m 5s"],
    ["turbo", "· 1m 5s"],
  ])("effort %p renders %p", (effort, expected) => {
    const out = renderTask({ id: "a", name: "x", startTime: 0, effort }, null, now, null);
    expect(strip(out.content)).toEndWith(expected);
  });

  test("effort trails the model letter", () => {
    const out = renderTask(
      { id: "a", name: "x", startTime: 0, tokenCount: 1500, effort: "low" },
      null,
      now,
      "Explore",
      null,
      null,
      "f",
    );
    expect(strip(out.content)).toContain("· 1m 5s · 1.5k · f · ∙ · Explore");
  });

  test("activity wins over the description and is not sentence-cased", () => {
    const out = renderTask(
      { id: "a", description: "you are implementing the parser" },
      null,
      now,
      null,
      "→ lead",
    );
    expect(strip(out.content)).toContain("→ lead");
    expect(strip(out.content)).not.toContain("implementing");
  });

  test("clean description overrides the raw stdin description as the fallback", () => {
    const out = renderTask(
      { id: "a", description: "you are implementing the parser" },
      null,
      now,
      null,
      null,
      "build the parser",
    );
    expect(strip(out.content)).toContain("Build the parser");
    expect(strip(out.content)).not.toContain("implementing");
  });

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
