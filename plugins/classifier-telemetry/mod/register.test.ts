import type { EngineInterface, On, ToolCallResult } from "claude-code";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];
import { type Engine, describe, expect, mock, test, tier } from "claude-code/testing";
import type { ModEventsInput } from "../../mod-events/types";

tier("user");

const CALL = { tool: "Bash", command: "ls", tool_use_id: "toolu_1" } as const;

interface World {
  events: ModEventsInput[];
  clock: ReturnType<typeof mock.clock>;
}

/**
 * Stands in for the engine and the mod-events floor beneath the mod.
 */
function worldOf(
  on: On,
  {
    decision = "ask",
    ms = 0,
    result = { result: "ok" },
    failCalls = 0,
    idFails = false,
  }: {
    decision?: "allow" | "ask" | "deny";
    ms?: number;
    result?: ToolCallResult;
    failCalls?: number;
    idFails?: boolean;
  } = {},
): World {
  const events: ModEventsInput[] = [];
  let failures = failCalls;
  let calls = 0;
  const clock = mock.clock(on, { now: 1_000 });
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => (events.push(e), { value: undefined }));
  on("tool.check", () => (decision === "allow" ? { decision, rule: "Bash(ls)" } : { decision }));
  on("tool.call", async () => {
    calls += 1;
    await clock.sleep(ms);
    if (failures-- > 0) throw new Error("tool crashed");
    return result;
  });
  return { events, clock };
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
        mod: "classifier-telemetry",
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
          reason: null,
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

  test("a tool call that throws leaves no verdict for a later call", async ($, on) => {
    const world = worldOf(on, { failCalls: 1 });
    await $.tool.check({ tool: CALL.tool, input: {}, tool_use_id: CALL.tool_use_id });
    const failed = expect($.tool.call(CALL)).rejects.toThrow("no implementation for tool.call");
    await world.clock.settle();
    await failed;

    await settle(world, $.tool.call(CALL));

    expect(world.events.map((e) => e.detail?.decision)).toEqual([null]);
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
    // The engine sets agentId from the loop; the kit's call type leaves it out.
    await settle(world, $.tool.call({ ...CALL, agentId: "a1" } as typeof CALL));

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

    expect(world.events).toEqual([
      {
        mod: "classifier-telemetry",
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
        mod: "classifier-telemetry",
        event: "server.tool",
        detail: expect.objectContaining({ tool_use_id: "srv_2" }),
      },
    ]);
  });

  test("marks the session live", async ($, on) => {
    const world = worldOf(on);
    on("session.start", (_, e) => ({ cwd: e.cwd }));

    await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });

    expect(world.events).toEqual([{ mod: "classifier-telemetry", event: "session.start" }]);
  });
});
