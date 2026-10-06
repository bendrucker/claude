import type { On, ToolCallResult } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";
import type { ModEventsInput } from "../../mod-events/types";
import { LIMIT, isPlanFile, statusText } from "./register.ts";

const HOME = "/Users/u";
const PLAN = `${HOME}/.claude/plans/quiet-otter.md`;

interface World {
  files: Record<string, string>;
  status: (string | undefined)[];
  events: ModEventsInput[];
}

function worldOf(on: On, { result = { result: "ok" } }: { result?: ToolCallResult } = {}): World {
  const world: World = { files: {}, status: [], events: [] };
  mock.env(on, { HOME });
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    world.events.push(e);
    return { value: undefined };
  });
  on("tool.call", () => result);
  on("fs.read", ($, e) => {
    const text = world.files[e.path];
    if (text === undefined) throw new Error("ENOENT");
    return { value: text };
  });
  on("ui.status", ($, e) => {
    world.status.push(e.text);
    return { value: undefined };
  });
  return world;
}

describe("isPlanFile", () => {
  test("takes a markdown file directly under the plans directory", () => {
    expect(isPlanFile(PLAN, HOME)).toBe(true);
    expect(isPlanFile(`${HOME}/.claude/plans/a/b.md`, HOME)).toBe(false);
    expect(isPlanFile(`${HOME}/.claude/plans/notes.txt`, HOME)).toBe(false);
    expect(isPlanFile("/repo/plans/a.md", HOME)).toBe(false);
  });
});

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
    world.files[PLAN] = "é".repeat(6_000);
    await $.tool.call({ tool: "Write", file_path: PLAN, content: "", tool_use_id: "t1" });
    expect(world.status).toEqual(["plan 6,000 / 10,000"]);
  });

  test("updates after an edit", async ($, on) => {
    const world = worldOf(on);
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

  test("ignores files outside the plans directory", async ($, on) => {
    const world = worldOf(on);
    world.files["/repo/a.md"] = "x";
    await $.tool.call({ tool: "Write", file_path: "/repo/a.md", content: "x", tool_use_id: "t1" });
    expect(world.status).toEqual([]);
  });

  test("ignores a failed write", async ($, on) => {
    const world = worldOf(on, { result: { result: "boom", isError: true } });
    world.files[PLAN] = "x";
    await $.tool.call({ tool: "Write", file_path: PLAN, content: "x", tool_use_id: "t1" });
    expect(world.status).toEqual([]);
  });

  test("passes the result through when the file cannot be read", async ($, on) => {
    const world = worldOf(on);
    const result = await $.tool.call({
      tool: "Write",
      file_path: PLAN,
      content: "x",
      tool_use_id: "t1",
    });
    expect(result.isError).not.toBe(true);
    expect(world.status).toEqual([]);
  });

  test("clears the count once a plan is approved", async ($, on) => {
    const world = worldOf(on);
    world.files[PLAN] = "x";
    await $.tool.call({ tool: "Write", file_path: PLAN, content: "x", tool_use_id: "t1" });
    await $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t2" });
    expect(world.status).toEqual(["plan 1 / 10,000", undefined]);
  });

  test("logs each count and each crossing of the limit", async ($, on) => {
    const world = worldOf(on);
    const write = async (chars: number, id: string) => {
      world.files[PLAN] = "x".repeat(chars);
      await $.tool.call({ tool: "Write", file_path: PLAN, content: "", tool_use_id: id });
    };
    await write(12_000, "t1");
    await write(11_000, "t2");
    await write(9_000, "t3");
    await write(9_500, "t4");
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

  test("records that it was live at session start", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(world.events).toEqual([{ mod: "plan", event: "session.start" }]);
  });
});
