import type { AgentInfo, EngineInterface, On, ProcessRunResult } from "claude-code";
import { type Engine, type MockClock, describe, expect, mock, test } from "claude-code/testing";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

const COMPLETE = {
  answer: "",
  durationMs: 1,
  isAborted: false,
  turnId: "t1",
  reason: "answer",
} as const;

function ran(stdout: string): ProcessRunResult {
  return { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false };
}

function agent(id: string, status: AgentInfo["status"]): AgentInfo {
  return { id, description: "", type: "general-purpose", status };
}

interface World {
  live: Set<string>;
  agents: AgentInfo[];
  ps: string;
  load: string;
  closed: string[];
  ran: string[];
  events: ModEventsInput[];
  /** Replaces the `session list` answer. */
  list: ProcessRunResult | undefined;
  clock: MockClock;
}

function worldOf(on: On): World {
  const world: World = {
    clock: mock.clock(on),
    list: undefined,
    live: new Set(),
    agents: [],
    ps: "",
    load: "{ 1.00 1.00 1.00 }\n14",
    closed: [],
    ran: [],
    events: [],
  };
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => (world.events.push(e), { value: undefined }));
  on("agent.list", () => ({ value: world.agents }));
  on("turn.complete", () => ({ text: "" }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("process.run", ($, e) => {
    const [bin, ...args] = e.argv;
    if (bin === "ps") return { value: ran(world.ps) };
    if (bin === "sysctl") return { value: ran(world.load) };
    if (args.at(-1) === "close") {
      const session = args[1] ?? "";
      world.closed.push(session);
      world.live.delete(session);
      return { value: ran("") };
    }
    if (world.list) return { value: world.list };
    const sessions = [...world.live];
    return { value: ran(JSON.stringify({ success: true, data: { sessions } })) };
  });
  on("tool.call", ($, e) => {
    if (e.tool === "Bash") {
      world.ran.push(e.command);
      for (const match of e.command.matchAll(/--session (\S+) open/g))
        world.live.add(match[1] ?? "");
    }
    return { result: "ok" };
  });
  return world;
}

const bash = ($: Engine, command: string, agentId?: string) =>
  // The engine sets agentId from the loop. The kit's call type leaves it out.
  $.tool.call({ tool: "Bash", command, tool_use_id: "toolu_1", ...(agentId && { agentId }) });

const names = (world: World) => world.events.map((e) => e.event);

describe("register", () => {
  test("closes a subagent's session once the agent ends, and no other", async ($, on) => {
    const world = worldOf(on);
    world.live.add("theirs");

    await bash($, "agent-browser --session ev-1 open https://x.test", "a1");
    world.agents = [agent("a1", "running")];
    await $.turn.complete({ ...COMPLETE, agentId: "a1" });
    expect(world.closed).toEqual([]);

    world.agents = [agent("a1", "killed")];
    await $.turn.complete(COMPLETE);
    expect(world.closed).toEqual(["ev-1"]);
    expect(world.live).toEqual(new Set(["theirs"]));
    expect(names(world)).toEqual(["browser.launch", "browser.close"]);
  });

  test("closes only the stopped subagent's sessions on SubagentStop", async ($, on) => {
    const world = worldOf(on);
    on("classic.SubagentStop", () => ({}));

    await bash($, "agent-browser --session ev-1 open x", "a1");
    await bash($, "agent-browser --session ev-2 open y", "a2");
    await $.classic.SubagentStop({
      stop_hook_active: false,
      agent_id: "a1",
      agent_transcript_path: "/t/a1.jsonl",
      agent_type: "general-purpose",
    });

    expect(world.closed).toEqual(["ev-1"]);
    expect(world.live).toEqual(new Set(["ev-2"]));
    expect(world.events.at(-1)).toEqual({
      mod: "load",
      event: "browser.close",
      ok: true,
      detail: { session: "ev-1", agent: "a1", trigger: "agent-stop", exitCode: 0, stderr: "" },
    });
  });

  test("sweeps an ended subagent's session on the 30s timer", async ($, on) => {
    const world = worldOf(on);

    await bash($, "agent-browser --session ev-1 open x", "a1");
    world.agents = [agent("a1", "killed")];
    await world.clock.advance(29_999);
    expect(world.closed).toEqual([]);

    await world.clock.advance(1);
    expect(world.closed).toEqual(["ev-1"]);
  });

  test("fails open when session list fails or answers garbage", async ($, on) => {
    const world = worldOf(on);

    world.list = { ...ran(""), exitCode: 1, stderr: "daemon down" };
    const failed = await bash($, "agent-browser --session ev-1 open x", "a1");
    world.list = ran("not json");
    const garbled = await bash($, "agent-browser --session ev-2 open y", "a1");
    world.list = ran(JSON.stringify({ data: { sessions: "nope" } }));
    const malformed = await bash($, "agent-browser --session ev-3 open z", "a1");

    for (const result of [failed, garbled, malformed]) expect(result.deny).toBeUndefined();
    expect(world.ran).toHaveLength(3);
    expect(names(world)).toEqual(["error", "error", "error"]);

    world.list = undefined;
    world.live.clear();
    await bash($, "agent-browser --session ev-4 open w", "a1");
    expect(names(world).at(-1)).toBe("browser.launch");
  });

  test("refuses a subagent's second session and lets the call through after close", async ($, on) => {
    const world = worldOf(on);

    await bash($, "agent-browser --session ev-1 open x", "a1");
    const denied = await bash($, "agent-browser --session ev-2 open y", "a1");
    expect(denied.deny).toContain("ev-1");

    await bash($, "agent-browser --session ev-1 close", "a1");
    world.live.delete("ev-1");
    const allowed = await bash($, "agent-browser --session ev-2 open y", "a1");
    expect(allowed.deny).toBeUndefined();
    expect(world.ran.at(-1)).toBe("agent-browser --session ev-2 open y");
  });

  test("closes the main loop's sessions at session end, not at /clear", async ($, on) => {
    const world = worldOf(on);

    await bash($, "agent-browser --session main-1 open x");
    await $.session.end({ reason: "clear", sessionId: "s1", resume: { id: "s1" } });
    expect(world.closed).toEqual([]);

    await $.session.end({ reason: "prompt_input_exit", sessionId: "s1", resume: { id: "s1" } });
    expect(world.closed).toEqual(["main-1"]);
  });

  const options = {
    caps: [String.raw`build:2:\b(?:vite|ladle)(?:\.js)? build\b`],
    maxLoadPerCore: 3,
    paceLoadPerCore: 1.5,
    strainLoadPerCore: 3,
  };

  test(
    "refuses a capped job while its pool is full and reports the machine state",
    { options },
    async ($, on) => {
      const world = worldOf(on);
      world.ps = [
        "10 1 node /r/node_modules/.bin/ladle build",
        "11 1 node /r/node_modules/vite/bin/vite.js build",
      ].join("\n");

      const denied = await bash($, "npx ladle build --outDir out");
      expect(denied.deny).toContain("2 build jobs");
      expect(world.ran).toEqual([]);
      expect(world.events.at(-1)).toEqual({
        mod: "load",
        event: "cap.deny",
        detail: {
          reason: "running",
          pools: ["build"],
          running: ["build", "build"],
          loadPerCore: 1 / 14,
          pressure: null,
          agent: null,
        },
      });
    },
  );

  test("caps nothing without configured caps", async ($, on) => {
    const world = worldOf(on);
    world.ps = "10 1 vite build\n11 1 vite build\n12 1 vite build";
    world.load = "{ 90.00 1.00 1.00 }\n14\n4";
    await bash($, "vite build");
    expect(world.ran).toEqual(["vite build"]);
    expect(world.events).toEqual([]);
  });

  test(
    "reminds each agent once per level as the machine gets busier",
    { options },
    async ($, on) => {
      const world = worldOf(on);
      const context = async (agentId?: string) => (await bash($, "ls", agentId)).context ?? [];

      expect(await context()).toEqual([]);

      world.load = "{ 28.00 1.00 1.00 }\n14";
      await world.clock.advance(15_000);
      const [busy] = await context();
      expect(busy).toContain("This machine is busy (load 2.0x its cores)");
      expect(await context()).toEqual([]);
      expect(await context("a1")).toHaveLength(1);

      world.load = "{ 56.00 1.00 1.00 }\n14";
      await world.clock.advance(15_000);
      expect((await context())[0]).toContain("strained");

      world.load = "{ 1.00 1.00 1.00 }\n14";
      await world.clock.advance(15_000);
      expect(await context()).toEqual([]);
      world.load = "{ 28.00 1.00 1.00 }\n14";
      await world.clock.advance(15_000);
      expect(await context()).toHaveLength(1);

      expect(names(world).filter((name) => name === "pace")).toHaveLength(4);
    },
  );

  test("passes other commands through untouched", async ($, on) => {
    const world = worldOf(on);
    await bash($, "ls -la");
    expect(world.ran).toEqual(["ls -la"]);
    expect(world.events).toEqual([]);
  });
});
