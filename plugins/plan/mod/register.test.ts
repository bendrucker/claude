import type { EngineInterface, On, PromptAttachmentInput, ToolCallResult } from "claude-code";
import { type Engine, describe, expect, test } from "claude-code/testing";
import { DELEGATION_FROM, LIMIT, overText, statusText } from "./register.ts";

const PLAN = "/Users/u/.claude/plans/quiet-otter.md";
const GUIDELINES = "# Planning Guidelines";
const DELEGATION = "# Delegation";
const DENIED: ToolCallResult = { result: "too long", isError: true };

interface World {
  files: Record<string, string>;
  references: Record<string, string>;
  status: (string | undefined)[];
  events: Parameters<EngineInterface["modEvents"]["emit"]>[0][];
}

function worldOf(
  on: On,
  {
    result = { result: "ok" },
    exit = result,
  }: { result?: ToolCallResult; exit?: ToolCallResult } = {},
): World {
  const world: World = {
    files: {},
    references: { "guidelines.md": GUIDELINES, "delegation.md": DELEGATION },
    status: [],
    events: [],
  };
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", (_, e) => {
    world.events.push(e);
    return { value: undefined };
  });
  on("prompt.attachment", (_, e) => ({ text: e.text }));
  on("tool.call", (_, e) => (e.tool === "ExitPlanMode" ? exit : result));
  on("fs.read", (_, e) => {
    const [, shipped] = /\/references\/([^/]+)$/.exec(e.path) ?? [];
    const text = shipped === undefined ? world.files[e.path] : world.references[shipped];
    if (text === undefined) throw new Error("ENOENT");
    return { value: text };
  });
  on("ui.status", (_, e) => {
    world.status.push(e.text);
    return { value: undefined };
  });
  return world;
}

interface Reminder {
  planFilePath?: string;
  reminder?: "full" | "sparse";
  agentId?: string;
}

function planMode($: Engine, { planFilePath = PLAN, reminder = "full", agentId }: Reminder = {}) {
  const input: PromptAttachmentInput = {
    type: "plan_mode",
    text: "plan mode",
    origin: { kind: "engine" },
    detail: { reminder, planFilePath, hasPlan: false },
  };
  if (agentId !== undefined) input.agentId = agentId;
  return $.prompt.attachment(input);
}

function planModeExit($: Engine, planFilePath = PLAN) {
  return $.prompt.attachment({
    type: "plan_mode_exit",
    text: "plan mode exited",
    origin: { kind: "engine" },
    detail: { planFilePath, hasPlan: true },
  });
}

function write($: Engine, world: World, chars: number, filePath = PLAN) {
  world.files[filePath] = "x".repeat(chars);
  return $.tool.call({ tool: "Write", file_path: filePath, content: "", tool_use_id: "t" });
}

describe("statusText", () => {
  test("shows from 90%, rounding down so a plan under the limit never reads 10k or 100%", () => {
    expect([8_999, 9_000, LIMIT - 1, 10_234, 12_034].map(statusText)).toEqual([
      undefined,
      "9k (90%)",
      "9.9k (99%)",
      "10.2k (102%)",
      "12k (120%)",
    ]);
  });
});

describe("register", () => {
  test("counts UTF-16 code units the way the gate does", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    world.files[PLAN] = "é".repeat(9_500);
    await $.tool.call({ tool: "Write", file_path: PLAN, content: "", tool_use_id: "t1" });
    expect(world.status).toEqual(["9.5k (95%)"]);
  });

  test("shows a plan over the limit only in plan mode", async ($, on) => {
    const world = worldOf(on);
    await write($, world, 11_700);
    expect(world.status).toEqual([]);
    expect(world.events).toEqual([]);

    await planMode($);
    await write($, world, 11_700);
    expect(world.status).toEqual(["11.7k (117%)"]);
  });

  test("clears the count when plan mode ends without ExitPlanMode", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 11_700);
    await planModeExit($);
    await write($, world, 11_700);
    expect(world.status).toEqual(["11.7k (117%)", undefined]);
  });

  test("ignores plan edits after the plan is approved", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 9_000);
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    await write($, world, 11_700);
    expect(world.status).toEqual(["9k (90%)", undefined]);
  });

  test("updates after an edit", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    world.files[PLAN] = "x".repeat(10_001);
    await $.tool.call({
      tool: "Edit",
      file_path: PLAN,
      old_string: "a",
      new_string: "b",
      tool_use_id: "t1",
    });
    expect(world.status).toEqual(["10k (100%)"]);
  });

  test("counts only the plan file the plan-mode reminder names", async ($, on) => {
    const world = worldOf(on);
    await write($, world, 9_500);
    await planMode($);
    await write($, world, 9_900, "/Users/u/.claude/plans/quiet-otter-decisions.md");
    await write($, world, 9_100);
    expect(world.status).toEqual(["9.1k (91%)"]);
  });

  test("clears the count when the plan drops under 90%", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 9_500);
    await write($, world, 8_000);
    await write($, world, 7_000);
    expect(world.status).toEqual(["9.5k (95%)", undefined]);
  });

  test("ignores a failed write", async ($, on) => {
    const world = worldOf(on, { result: { result: "boom", isError: true } });
    await planMode($);
    await write($, world, 1);
    expect(world.status).toEqual([]);
  });

  test("clears the count when the file cannot be read", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 9_500);
    delete world.files[PLAN];
    const result = await $.tool.call({
      tool: "Write",
      file_path: PLAN,
      content: "x",
      tool_use_id: "t1",
    });
    expect(result.isError).not.toBe(true);
    expect(world.status).toEqual(["9.5k (95%)", undefined]);
  });

  test("logs each count and each crossing of the limit", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 12_000);
    await write($, world, 11_000);
    await write($, world, 9_000);
    await write($, world, 9_500);
    const counts = world.events.filter((e) => e.event === "count" || e.event === "crossed");
    expect(counts.map((e) => [e.event, e.detail?.chars, e.detail?.direction])).toEqual([
      ["count", 12_000, undefined],
      ["crossed", 12_000, "over"],
      ["count", 11_000, undefined],
      ["count", 9_000, undefined],
      ["crossed", 9_000, "under"],
      ["count", 9_500, undefined],
    ]);
    expect(counts[0]).toEqual({
      mod: "plan",
      event: "count",
      detail: { file: "quiet-otter.md", chars: 12_000, limit: LIMIT, over: true, tool: "Write" },
    });
  });

  test("logs each presentation and clears the count once a plan is approved", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 9_000);
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    expect(world.status).toEqual(["9k (90%)", undefined]);
    expect(world.events.at(-1)).toEqual({
      mod: "plan",
      event: "present",
      ok: true,
      detail: { file: "quiet-otter.md", chars: 9_000, limit: LIMIT, over: false },
    });
  });

  test("logs a denied presentation and keeps the count", async ($, on) => {
    const world = worldOf(on, { exit: DENIED });
    await planMode($);
    await write($, world, 12_000);
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    expect(world.status).toEqual(["12k (120%)"]);
    expect(world.events.at(-1)).toMatchObject({ event: "present", ok: false });
  });

  test("clears the count when a denied plan cannot be read", async ($, on) => {
    const world = worldOf(on, { exit: DENIED });
    await planMode($);
    await write($, world, 12_000);
    delete world.files[PLAN];
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    expect(world.status).toEqual(["12k (120%)", undefined]);
    expect(world.events.map((e) => e.event)).not.toContain("present");
  });

  test("records that it was live at session start", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(world.events).toEqual([{ mod: "plan", event: "session.start" }]);
  });

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const reason of ["clear", "resume"] as const) {
    test(`a session ending on ${reason} leaves plan mode and clears the count`, async ($, on) => {
      const world = worldOf(on);
      on("session.end", (_, e) => ({ sessionId: e.sessionId }));
      await planMode($);
      await write($, world, 11_700);
      await $.session.end({ reason, sessionId: "s1", resume: { id: "s1" } });
      await write($, world, 11_700);
      expect(world.status).toEqual(["11.7k (117%)", undefined]);
    });
  }

  test("a session ending on exit keeps the count", async ($, on) => {
    const world = worldOf(on);
    on("session.end", (_, e) => ({ sessionId: e.sessionId }));
    await planMode($);
    await write($, world, 11_700);
    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    await write($, world, 11_800);
    expect(world.status).toEqual(["11.7k (117%)", "11.8k (118%)"]);
  });
});

describe("guidelines", () => {
  test("ride on the first full reminder, once per conversation", async ($, on) => {
    const world = worldOf(on);
    expect((await planMode($, { reminder: "sparse" })).text).toBe("plan mode");
    expect((await planMode($)).text).toBe(`plan mode\n\n${GUIDELINES}`);
    expect((await planMode($)).text).toBe("plan mode");
    await planModeExit($);
    expect((await planMode($)).text).toBe("plan mode");
    expect(world.events).toEqual([{ mod: "plan", event: "inject", ok: true }]);
  });

  test("skip a subagent's reminder", async ($, on) => {
    worldOf(on);
    expect((await planMode($, { agentId: "a1" })).text).toBe("plan mode");
    expect((await planMode($)).text).toBe(`plan mode\n\n${GUIDELINES}`);
  });

  test("return after a compaction of the main conversation", async ($, on) => {
    worldOf(on);
    on("session.compact", (_, e) =>
      e.instructions === "skip" ? { skip: "no" } : { messages: e.messages },
    );
    const messages = [{ role: "user" as const, text: "summary", toolUses: [] }];
    await planMode($);
    await $.session.compact({ trigger: "auto", agentId: "a1", messages });
    await $.session.compact({ trigger: "manual", instructions: "skip", messages });
    expect((await planMode($)).text).toBe("plan mode");
    await $.session.compact({ trigger: "auto", messages });
    expect((await planMode($)).text).toBe(`plan mode\n\n${GUIDELINES}`);
  });

  test("leave the reminder as it was when the file cannot be read", async ($, on) => {
    const world = worldOf(on);
    delete world.references["guidelines.md"];
    expect((await planMode($)).text).toBe("plan mode");
    expect(world.events).toEqual([{ mod: "plan", event: "inject", ok: false }]);
  });
});

describe("delegation", () => {
  function writePlan($: Engine, world: World, plan: string) {
    world.files[PLAN] = plan;
    return $.tool.call({ tool: "Write", file_path: PLAN, content: "", tool_use_id: "t" });
  }

  test("attaches once a plan reaches its size, once per plan file", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    expect((await writePlan($, world, "x".repeat(DELEGATION_FROM - 1))).context).toBeUndefined();
    expect((await writePlan($, world, "x".repeat(DELEGATION_FROM))).context).toEqual([DELEGATION]);
    expect((await writePlan($, world, "x".repeat(DELEGATION_FROM + 1))).context).toBeUndefined();
    expect(world.events.filter((e) => e.event === "delegation")).toEqual([
      {
        mod: "plan",
        event: "delegation",
        ok: true,
        detail: { file: "quiet-otter.md", chars: DELEGATION_FROM },
      },
    ]);

    await planMode($, { planFilePath: "/Users/u/.claude/plans/brave-fox.md" });
    world.files["/Users/u/.claude/plans/brave-fox.md"] = "x".repeat(DELEGATION_FROM);
    const next = await $.tool.call({
      tool: "Write",
      file_path: "/Users/u/.claude/plans/brave-fox.md",
      content: "",
      tool_use_id: "t",
    });
    expect(next.context).toEqual([DELEGATION]);
  });

  test("rides ahead of the over-limit warning when one write crosses both", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    expect((await writePlan($, world, "x".repeat(LIMIT + 1))).context).toEqual([
      DELEGATION,
      overText(LIMIT + 1),
    ]);
  });

  test("skips a plan that already carries a Delegation section", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    const plan = `# Plan\n\n## Delegation\n\n${"x".repeat(DELEGATION_FROM)}`;
    expect((await writePlan($, world, plan)).context).toBeUndefined();
  });
});

describe("over-limit warning", () => {
  test("follows every write that leaves the plan over the limit, and no other", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    const plan = (chars: number) => `## Delegation\n${"x".repeat(chars)}`;
    const contextOf = async (text: string, filePath = PLAN) => {
      world.files[filePath] = text;
      return (
        await $.tool.call({
          tool: "Edit",
          file_path: filePath,
          old_string: "",
          new_string: "",
          tool_use_id: "t",
        })
      ).context;
    };
    expect(await contextOf(plan(LIMIT - 20))).toBeUndefined();
    const over = plan(LIMIT);
    expect(await contextOf(over)).toEqual([overText(over.length)]);
    expect(await contextOf(over)).toEqual([overText(over.length)]);
    expect(await contextOf(over, "/repo/notes.md")).toBeUndefined();
  });
});
