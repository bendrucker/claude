import type { EngineInterface, On, ToolCallResult } from "claude-code";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];
import { type Engine, describe, expect, mock, test, tier } from "claude-code/testing";

tier("user");

const CALL = { tool: "Bash", command: "ls", tool_use_id: "toolu_1" } as const;

interface World {
  writes: Record<string, unknown>;
  events: ModEventsInput[];
  calls: () => number;
  clock: ReturnType<typeof mock.clock>;
}

/**
 * Stands in for the engine beneath the mod.
 */
function worldOf(
  on: On,
  {
    decision = "ask",
    ms = 0,
    result = { result: "ok" },
    writeFails = false,
    failCalls = 0,
    idFails = false,
  }: {
    decision?: "allow" | "ask" | "deny";
    ms?: number;
    result?: ToolCallResult;
    writeFails?: boolean;
    failCalls?: number;
    idFails?: boolean;
  } = {},
): World {
  const writes: Record<string, unknown> = {};
  const events: ModEventsInput[] = [];
  let failures = failCalls;
  let calls = 0;
  const clock = mock.clock(on, { now: 1_000 });
  mock.env(on, { HOME: "/Users/u" });
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    events.push(e);
    return { value: undefined };
  });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.id", () => {
    if (idFails) throw new Error("no session");
    return { value: "s1" };
  });
  on("tool.check", () => (decision === "allow" ? { decision, rule: "Bash(ls)" } : { decision }));
  on("tool.call", async () => {
    calls += 1;
    await clock.sleep(ms);
    if (failures-- > 0) throw new Error("tool crashed");
    return result;
  });
  on("fs.write", ($, e) => {
    if (writeFails) throw new Error("disk full");
    writes[e.path] = JSON.parse(e.text);
    return { value: undefined };
  });
  return { writes, events, calls: () => calls, clock };
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

describe("register", () => {
  test("records an auto-mode ask with its wall time", async ($, on) => {
    const world = worldOf(on, { ms: 2_500 });

    expect(await run($, world, 2_500)).toEqual({ result: "ok" });

    expect(world.writes).toEqual({
      "/Users/u/.claude/classifier-telemetry/s1/toolu_1.json": {
        kind: "verdict",
        session_id: "s1",
        tool_use_id: "toolu_1",
        agent_id: null,
        tool: "Bash",
        interactive: false,
        decision: "ask",
        rule: null,
        hook: null,
        reason: null,
        started_at: 1_000,
        check_ms: 0,
        duration_ms: 2_500,
        outcome: "ok",
      },
    });
  });

  const OUTCOMES: {
    name: string;
    decision: "allow" | "ask";
    result: ToolCallResult;
    want: { decision: string; rule: string | null; outcome: string };
  }[] = [
    {
      name: "a rule allow",
      decision: "allow",
      result: { result: "ok" },
      want: { decision: "allow", rule: "Bash(ls)", outcome: "ok" },
    },
    {
      name: "a tool error",
      decision: "ask",
      result: { isError: true, result: "boom" },
      want: { decision: "ask", rule: null, outcome: "error" },
    },
    {
      name: "a hook deny",
      decision: "ask",
      result: { deny: "no" },
      want: { decision: "ask", rule: null, outcome: "deny" },
    },
  ];

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const { name, decision, result, want } of OUTCOMES) {
    test(`records ${name}`, async ($, on) => {
      const world = worldOf(on, { decision, result });

      await run($, world, 0);

      expect(Object.values(world.writes)).toEqual([expect.objectContaining(want)]);
    });
  }

  test("a failed write still returns the call's result", async ($, on) => {
    const world = worldOf(on, { writeFails: true });

    expect(await run($, world, 0)).toEqual({ result: "ok" });
  });

  test("a tool call that throws leaves no verdict for a later call", async ($, on) => {
    const world = worldOf(on, { failCalls: 1 });
    await $.tool.check({ tool: CALL.tool, input: {}, tool_use_id: CALL.tool_use_id });
    const failed = expect($.tool.call(CALL)).rejects.toThrow("no implementation for tool.call");
    await world.clock.settle();
    await failed;

    const pending = $.tool.call(CALL);
    await world.clock.settle();
    await pending;

    expect(Object.values(world.writes)).toEqual([expect.objectContaining({ decision: null })]);
  });

  test("a call the check never saw records no verdict", async ($, on) => {
    const world = worldOf(on);

    const pending = $.tool.call(CALL);
    await world.clock.settle();
    await pending;

    expect(Object.values(world.writes)).toEqual([
      expect.objectContaining({ decision: null, check_ms: null }),
    ]);
  });

  test("keys a subagent's verdict on its loop", async ($, on) => {
    const world = worldOf(on, { decision: "allow" });
    await $.tool.check({ tool: "Bash", input: {}, tool_use_id: "toolu_1", agentId: "a1" });

    const main = $.tool.call(CALL);
    await world.clock.settle();
    await main;
    expect(Object.values(world.writes)).toEqual([
      expect.objectContaining({ agent_id: null, decision: null }),
    ]);

    // The engine sets agentId from the loop; the kit's call type leaves it out.
    const sub = $.tool.call({ ...CALL, agentId: "a1" } as typeof CALL);
    await world.clock.settle();
    await sub;
    expect(Object.values(world.writes)).toEqual([
      expect.objectContaining({ agent_id: "a1", decision: "allow", rule: "Bash(ls)" }),
    ]);
  });

  test("marks a tool that waits on the person as interactive", async ($, on) => {
    const world = worldOf(on);

    const pending = $.tool.call({ tool: "AskUserQuestion", questions: [], tool_use_id: "toolu_2" });
    await world.clock.settle();
    await pending;

    expect(Object.values(world.writes)).toEqual([
      expect.objectContaining({ tool: "AskUserQuestion", interactive: true }),
    ]);
  });

  test("records each server tool a step ran", async ($, on) => {
    const world = worldOf(on);
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

    const stream = $.turn.step({ turnId: "t1", index: 2, model: "m", messageCount: 1 });
    const drained = (async () => {
      for await (const _ of stream);
    })();
    await world.clock.advance(750);
    await drained;

    expect(world.writes).toEqual({
      "/Users/u/.claude/classifier-telemetry/s1/srv_1.json": {
        kind: "server_tool",
        session_id: "s1",
        tool_use_id: "srv_1",
        agent_id: null,
        tool: "advisor",
        turn_id: "t1",
        step: 2,
        started_at: 5_000,
        duration_ms: 750,
      },
      "/Users/u/.claude/classifier-telemetry/s1/srv_2.json": expect.objectContaining({
        duration_ms: null,
      }),
    });
  });
});
