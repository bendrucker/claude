import type { On, ToolCallResult } from "claude-code";
import { type Engine, describe, expect, test } from "claude-code/testing";
import { LIMIT, statusText } from "./register.ts";

const PLAN = "/Users/u/.claude/plans/quiet-otter.md";

interface World {
  files: Record<string, string>;
  status: (string | undefined)[];
  events: Parameters<Engine["modEvents"]["emit"]>[0][];
}

function worldOf(on: On, { result = { result: "ok" } }: { result?: ToolCallResult } = {}): World {
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
  on("tool.call", () => result);
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

function write($: Engine, world: World, chars: number, filePath = PLAN) {
  world.files[filePath] = "x".repeat(chars);
  return $.tool.call({ tool: "Write", file_path: filePath, content: "", tool_use_id: "t" });
}

describe("statusText", () => {
  test("shows the count against the limit and the overage", () => {
    expect(statusText(8_412)).toBe("plan 8,412 / 10,000");
    expect(statusText(LIMIT)).toBe("plan 10,000 / 10,000");
    expect(statusText(12_034)).toBe("plan 12,034 / 10,000 (over by 2,034)");
  });
});

describe("register", () => {
  test("counts UTF-16 code units the way the gate does", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    world.files[PLAN] = "é".repeat(6_000);
    await $.tool.call({ tool: "Write", file_path: PLAN, content: "", tool_use_id: "t1" });
    expect(world.status).toEqual(["plan 6,000 / 10,000"]);
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
    expect(world.status).toEqual(["plan 10,001 / 10,000 (over by 1)"]);
  });

  test("counts only the plan file the plan-mode reminder names", async ($, on) => {
    const world = worldOf(on);
    await write($, world, 500);
    await planMode($);
    await write($, world, 200, "/Users/u/.claude/plans/quiet-otter-decisions.md");
    await write($, world, 800);
    expect(world.status).toEqual(["plan 800 / 10,000"]);
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
    const result = await $.tool.call({
      tool: "Write",
      file_path: PLAN,
      content: "x",
      tool_use_id: "t1",
    });
    expect(result.isError).not.toBe(true);
    expect(world.status).toEqual([undefined]);
  });

  test("logs each count and each crossing of the limit", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 12_000);
    await write($, world, 11_000);
    await write($, world, 9_000);
    await write($, world, 9_500);
    expect(world.events.map((e) => [e.event, e.detail?.chars, e.detail?.direction])).toEqual([
      ["plan.count", 12_000, undefined],
      ["plan.crossed", 12_000, "over"],
      ["plan.count", 11_000, undefined],
      ["plan.count", 9_000, undefined],
      ["plan.crossed", 9_000, "under"],
      ["plan.count", 9_500, undefined],
    ]);
    expect(world.events[0]).toEqual({
      mod: "plan",
      event: "plan.count",
      detail: { file: "quiet-otter.md", chars: 12_000, limit: LIMIT, over: true, tool: "Write" },
    });
  });

  test("logs each presentation and clears the count once a plan is approved", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await write($, world, 1);
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    expect(world.status).toEqual(["plan 1 / 10,000", undefined]);
    expect(world.events.at(-1)).toEqual({
      mod: "plan",
      event: "plan.present",
      ok: true,
      detail: { file: "quiet-otter.md", chars: 1, limit: LIMIT, over: false },
    });
  });

  test("logs a denied presentation and keeps the count", async ($, on) => {
    const world = worldOf(on, { result: { result: "too long", isError: true } });
    await planMode($);
    world.files[PLAN] = "x".repeat(12_000);
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    expect(world.status).toEqual([]);
    expect(world.events.at(-1)).toMatchObject({ event: "plan.present", ok: false });
  });

  test("records that it was live at session start", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(world.events).toEqual([{ mod: "plan", event: "session.start" }]);
  });
});
