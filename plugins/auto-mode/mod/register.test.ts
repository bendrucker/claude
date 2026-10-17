import type { EngineInterface, On, ToolCallResult, TurnStepInput } from "claude-code";

import { type Engine, describe, expect, mock, test, tier } from "claude-code/testing";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

tier("user");

const CALL = { tool: "Bash", command: "ls", tool_use_id: "toolu_1" } as const;

interface World {
  events: ModEventsInput[];
  calls: () => number;
  clock: ReturnType<typeof mock.clock>;
}

function seatEvents(on: On): ModEventsInput[] {
  const events: ModEventsInput[] = [];
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => (events.push(e), { value: undefined }));
  return events;
}

function worldOf(
  on: On,
  {
    decision = "ask",
    ms = 0,
    result = { result: "ok" },
    failCalls = 0,
    verdict = {},
  }: {
    decision?: "allow" | "ask" | "deny";
    ms?: number;
    result?: ToolCallResult;
    failCalls?: number;
    verdict?: { setting?: string; decider?: "host" };
  } = {},
): World {
  const events = seatEvents(on);
  let failures = failCalls;
  let calls = 0;
  const clock = mock.clock(on, { now: 1_000 });
  on("tool.check", () =>
    decision === "allow" ? { decision, rule: "Bash(ls)", ...verdict } : { decision, ...verdict },
  );
  on("tool.call", async () => {
    calls += 1;
    await clock.sleep(ms);
    if (failures-- > 0) throw new Error("tool crashed");
    return result;
  });
  return { events, calls: () => calls, clock };
}

async function run($: Engine, world: World, ms: number) {
  await $.tool.check({
    tool: CALL.tool,
    input: { command: CALL.command },
    tool_use_id: CALL.tool_use_id,
  });
  const pending = $.tool.call(CALL);
  await world.clock.advance(ms);
  return pending;
}

function stubStep(on: On, world: World) {
  on("turn.step", async function* () {
    yield* [];
    await world.clock.sleep(750);
    return {
      turnId: "t1",
      index: 2,
      answer: "",
      toolUses: [],
      serverToolUses: [
        { id: "srv_1", name: "advisor", input: {}, startedAt: 5_000, endedAt: 5_750 },
        { id: "srv_2", name: "advisor", input: {}, startedAt: 6_000 },
      ],
      stopReason: "end_turn",
      usage: null,
    };
  });
}

async function drainStep($: Engine, world: World, input: TurnStepInput) {
  const stream = $.turn.step(input);
  const drained = (async () => {
    for await (const _ of stream);
  })();
  await world.clock.advance(750);
  await drained;
}

async function settle(world: World, pending: Promise<unknown>) {
  await world.clock.settle();
  await pending;
}

describe("register", () => {
  test("records an ask with its wall time", async ($, on) => {
    const world = worldOf(on, { ms: 2_500 });

    expect(await run($, world, 2_500)).toEqual({ result: "ok" });

    expect(world.events).toEqual([
      {
        mod: "auto-mode",
        event: "tool.verdict",
        ok: true,
        ms: 2_500,
        detail: {
          tool_use_id: "toolu_1",
          agent_id: null,
          tool: "Bash",
          interactive: false,
          decision: "ask",
          rule: null,
          hook: null,
          setting: null,
          decider: null,
          ceiling: null,
          reason: null,
          read_only: false,
          started_at: 1_000,
          check_ms: 0,
          outcome: "ok",
        },
      },
    ]);
  });

  const OUTCOMES: {
    name: string;
    decision: "allow" | "ask";
    result: ToolCallResult;
    want: { ok: boolean; detail: unknown };
  }[] = [
    {
      name: "a rule allow",
      decision: "allow",
      result: { result: "ok" },
      want: { ok: true, detail: expect.objectContaining({ decision: "allow", rule: "Bash(ls)" }) },
    },
    {
      name: "a tool error",
      decision: "ask",
      result: { isError: true, result: "boom" },
      want: { ok: false, detail: expect.objectContaining({ outcome: "error" }) },
    },
    {
      name: "a hook deny",
      decision: "ask",
      result: { deny: "no" },
      want: { ok: false, detail: expect.objectContaining({ outcome: "deny" }) },
    },
  ];

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const { name, decision, result, want } of OUTCOMES) {
    test(`records ${name}`, async ($, on) => {
      const world = worldOf(on, { decision, result });

      await run($, world, 0);

      expect(world.events).toEqual([expect.objectContaining(want)]);
    });
  }

  test("records a tool call that throws, leaving no verdict for a later call", async ($, on) => {
    const world = worldOf(on, { failCalls: 1 });
    await $.tool.check({ tool: CALL.tool, input: {}, tool_use_id: CALL.tool_use_id });
    const failed = expect($.tool.call(CALL)).rejects.toThrow("no implementation for tool.call");
    await world.clock.settle();
    await failed;
    expect(world.calls()).toBe(1);

    await settle(world, $.tool.call(CALL));

    expect(world.events.map((e) => [e.detail?.decision, e.detail?.outcome])).toEqual([
      ["ask", "throw"],
      [null, "ok"],
    ]);
  });

  test("records the check's setting and decider, and a read-only run", async ($, on) => {
    const world = worldOf(on, {
      result: { result: "ok", isReadOnly: true },
      verdict: { setting: "permissions.blockReadsOutsideWorkingDirectories", decider: "host" },
    });

    await run($, world, 0);

    expect(world.events).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({
          setting: "permissions.blockReadsOutsideWorkingDirectories",
          decider: "host",
          ceiling: null,
          read_only: true,
        }),
      }),
    ]);
  });

  test("fails open when the clock rejects", async ($, on) => {
    const events = seatEvents(on);
    let calls = 0;
    on("clock.now", () => {
      throw new Error("clock down");
    });
    on("tool.check", () => ({ decision: "ask" }));
    on("tool.call", () => ((calls += 1), { result: "ok" }));

    expect(
      await $.tool.check({ tool: CALL.tool, input: {}, tool_use_id: CALL.tool_use_id }),
    ).toEqual(expect.objectContaining({ decision: "ask" }));
    expect(await $.tool.call(CALL)).toEqual(expect.objectContaining({ result: "ok" }));

    expect(calls).toBe(1);
    expect(events).toEqual([]);
  });

  test("a call the check never saw records no verdict", async ($, on) => {
    const world = worldOf(on);

    await settle(world, $.tool.call(CALL));

    expect(world.events).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({ decision: null, check_ms: null }),
      }),
    ]);
  });

  test("keys a subagent's verdict on its loop", async ($, on) => {
    const world = worldOf(on, { decision: "allow" });
    await $.tool.check({ tool: "Bash", input: {}, tool_use_id: "toolu_1", agentId: "a1" });

    await settle(world, $.tool.call(CALL));
    // The engine sets agentId from the loop. The kit's call type leaves it out.
    const subagentCall = { ...CALL, agentId: "a1" };
    await settle(world, $.tool.call(subagentCall));

    expect(world.events.map((e) => e.detail)).toEqual([
      expect.objectContaining({ agent_id: null, decision: null }),
      expect.objectContaining({ agent_id: "a1", decision: "allow", rule: "Bash(ls)" }),
    ]);
  });

  test("marks a tool that waits on the person as interactive", async ($, on) => {
    const world = worldOf(on);

    await settle(
      world,
      $.tool.call({ tool: "AskUserQuestion", questions: [], tool_use_id: "toolu_2" }),
    );

    expect(world.events).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({ tool: "AskUserQuestion", interactive: true }),
      }),
    ]);
  });

  test("records each server tool a step ran", async ($, on) => {
    const world = worldOf(on);
    stubStep(on, world);

    await drainStep($, world, { turnId: "t1", index: 2, model: "m", messageCount: 1 });

    expect(world.events).toEqual([
      {
        mod: "auto-mode",
        event: "server.tool",
        ms: 750,
        detail: {
          tool_use_id: "srv_1",
          agent_id: null,
          tool: "advisor",
          turn_id: "t1",
          step: 2,
          started_at: 5_000,
        },
      },
      {
        mod: "auto-mode",
        event: "server.tool",
        detail: expect.objectContaining({ tool_use_id: "srv_2" }),
      },
    ]);
  });

  test("records a subagent step's server tools on its loop", async ($, on) => {
    const world = worldOf(on);
    stubStep(on, world);

    await drainStep($, world, {
      turnId: "t1",
      index: 2,
      model: "m",
      messageCount: 1,
      agentId: "a1",
    });

    expect(world.events.map((e) => [e.event, e.detail?.agent_id])).toEqual([
      ["server.tool", "a1"],
      ["server.tool", "a1"],
    ]);
  });

  test("marks the session live", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));

    await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });

    expect(world.events).toEqual([{ mod: "auto-mode", event: "session.start" }]);
  });

  test("records a classifier refusal with its reason and mode", async ($, on) => {
    const world = worldOf(on);
    on("classic.PermissionDenied", () => ({}));

    await $.classic.PermissionDenied({
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
      tool_use_id: "toolu_9",
      reason: "destroys the filesystem",
      permission_mode: "auto",
    });

    expect(world.events).toEqual([
      {
        mod: "auto-mode",
        event: "classifier.deny",
        detail: {
          tool_use_id: "toolu_9",
          tool_name: "Bash",
          permission_mode: "auto",
          reason: "destroys the filesystem",
        },
      },
    ]);
  });
});
