import type { EngineInterface, On, PromptAttachmentInput, ToolCallResult } from "claude-code";
import { type Engine, describe, expect, test } from "claude-code/testing";

const PLAN = "/Users/u/.claude/plans/quiet-otter.md";
const APPROVED: ToolCallResult = { result: "ok" };
const DENIED: ToolCallResult = { result: "denied", isError: true };

interface World {
  files: Record<string, string>;
  events: Parameters<EngineInterface["modEvents"]["emit"]>[0][];
}

function worldOf(on: On, exit = APPROVED): World {
  const world: World = { files: {}, events: [] };
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", (_, e) => {
    world.events.push(e);
    return { value: undefined };
  });
  on("prompt.attachment", (_, e) => ({ text: e.text }));
  on("tool.call", () => exit);
  on("fs.read", (_, e) => {
    const text = world.files[e.path];
    if (text === undefined) throw new Error("ENOENT");
    return { value: text };
  });
  return world;
}

function planMode($: Engine, agentId?: string) {
  const input: PromptAttachmentInput = {
    type: "plan_mode",
    text: "plan mode",
    origin: { kind: "engine" },
    detail: { reminder: "full", planFilePath: PLAN, hasPlan: false },
  };
  if (agentId !== undefined) input.agentId = agentId;
  return $.prompt.attachment(input);
}

function exitPlanMode($: Engine) {
  return $.tool.call({ tool: "ExitPlanMode", tool_use_id: "t" });
}

describe("register", () => {
  test("records that it was live at session start", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(world.events).toEqual([{ mod: "plan", event: "session.start" }]);
  });

  test("leaves the plan-mode reminder unchanged", async ($, on) => {
    worldOf(on);
    expect((await planMode($)).text).toBe("plan mode");
  });

  test("logs each presentation with the plan's size", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    world.files[PLAN] = "é".repeat(9_000);
    await exitPlanMode($);
    expect(world.events).toEqual([
      { mod: "plan", event: "present", ok: true, detail: { file: "quiet-otter.md", chars: 9_000 } },
    ]);
  });

  test("logs a denied presentation", async ($, on) => {
    const world = worldOf(on, DENIED);
    await planMode($);
    world.files[PLAN] = "plan";
    await exitPlanMode($);
    expect(world.events.at(-1)).toMatchObject({ event: "present", ok: false });
  });

  test("skips a presentation whose plan file a subagent's reminder named", async ($, on) => {
    const world = worldOf(on);
    await planMode($, "agent-1");
    world.files[PLAN] = "plan";
    await exitPlanMode($);
    expect(world.events).toEqual([]);
  });

  test("skips a presentation whose plan cannot be read", async ($, on) => {
    const world = worldOf(on);
    await planMode($);
    await exitPlanMode($);
    expect(world.events).toEqual([]);
  });

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const reason of ["clear", "resume"] as const) {
    test(`forgets the plan file when a session ends on ${reason}`, async ($, on) => {
      const world = worldOf(on);
      on("session.end", (_, e) => ({ sessionId: e.sessionId }));
      await planMode($);
      world.files[PLAN] = "plan";
      await $.session.end({ reason, sessionId: "s1", resume: { id: "s1" } });
      await exitPlanMode($);
      expect(world.events).toEqual([]);
    });
  }
});
