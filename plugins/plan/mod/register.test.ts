import type { EngineInterface, On, ToolCallResult } from "claude-code";
import { type Engine, describe, expect, test } from "claude-code/testing";
import { LIMIT, statusText } from "./register.ts";

const PLAN = "/Users/u/.claude/plans/quiet-otter.md";
const DENIED: ToolCallResult = { result: "too long", isError: true };

interface World {
  files: Record<string, string>;
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
  const world: World = { files: {}, status: [], events: [] };
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
    const text = world.files[e.path];
    if (text === undefined) throw new Error("ENOENT");
    return { value: text };
  });
  on("ui.status", (_, e) => {
    world.status.push(e.text);
    return { value: undefined };
  });
  return world;
}

function planMode($: Engine, planFilePath = PLAN) {
  return $.prompt.attachment({
    type: "plan_mode",
    text: "plan mode",
    origin: { kind: "engine" },
    detail: { reminder: "full", planFilePath, hasPlan: false },
  });
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
    expect(world.events.map((e) => [e.event, e.detail?.chars, e.detail?.direction])).toEqual([
      ["count", 12_000, undefined],
      ["crossed", 12_000, "over"],
      ["count", 11_000, undefined],
      ["count", 9_000, undefined],
      ["crossed", 9_000, "under"],
      ["count", 9_500, undefined],
    ]);
    expect(world.events[0]).toEqual({
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
    expect(world.events.map((e) => e.event)).toEqual(["count", "crossed"]);
  });

  test("records that it was live at session start", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(world.events).toEqual([{ mod: "plan", event: "session.start" }]);
  });
});
