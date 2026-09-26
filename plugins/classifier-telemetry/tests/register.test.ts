import type { On, ToolCallResult } from "claude-code";
import { type Engine, describe, expect, mock, test, tier } from "claude-code/testing";

tier("user");

const CALL = { tool: "Bash", command: "ls", tool_use_id: "toolu_1" } as const;

interface World {
  writes: Record<string, unknown>;
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
  }: {
    decision?: "allow" | "ask" | "deny";
    ms?: number;
    result?: ToolCallResult;
    writeFails?: boolean;
  } = {},
): World {
  const writes: Record<string, unknown> = {};
  const clock = mock.clock(on, { now: 1_000 });
  mock.env(on, { HOME: "/Users/u" });
  on("session.id", () => ({ value: "s1" }));
  on("tool.check", () => (decision === "allow" ? { decision, rule: "Bash(ls)" } : { decision }));
  on("tool.call", async () => {
    await clock.sleep(ms);
    return result;
  });
  on("fs.write", ($, e) => {
    if (writeFails) throw new Error("disk full");
    writes[e.path] = JSON.parse(e.text);
    return { value: undefined };
  });
  return { writes, clock };
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
        session_id: "s1",
        tool_use_id: "toolu_1",
        agent_id: null,
        tool: "Bash",
        decision: "ask",
        rule: null,
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

  test("a call the check never saw records no verdict", async ($, on) => {
    const world = worldOf(on);

    const pending = $.tool.call(CALL);
    await world.clock.settle();
    await pending;

    expect(Object.values(world.writes)).toEqual([
      expect.objectContaining({ decision: null, check_ms: null }),
    ]);
  });
});
