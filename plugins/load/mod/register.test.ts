import type { AgentInfo, EngineInterface, On, ProcessRunResult } from "claude-code";
import { type Engine, describe, expect, mock, test } from "claude-code/testing";

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
}

function worldOf(on: On): World {
  const world: World = {
    live: new Set(),
    agents: [],
    ps: "",
    load: "{ 1.00 1.00 1.00 }\n14",
    closed: [],
    ran: [],
    events: [],
  };
  mock.clock(on);
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

  test("refuses a build while two run and reports the machine state", async ($, on) => {
    const world = worldOf(on);
    world.ps = "node /r/node_modules/.bin/ladle build\nnode /r/node_modules/vite/bin/vite.js build";

    const denied = await bash($, "npx ladle build --outDir out");
    expect(denied.deny).toContain("2 heavy builds");
    expect(world.ran).toEqual([]);
    expect(world.events.at(-1)).toEqual({
      mod: "load",
      event: "build.deny",
      detail: {
        reason: "running",
        kinds: ["ladle"],
        running: ["ladle", "vite"],
        loadPerCore: 1 / 14,
        agent: null,
      },
    });
  });

  test("passes other commands through untouched", async ($, on) => {
    const world = worldOf(on);
    await bash($, "ls -la");
    expect(world.ran).toEqual(["ls -la"]);
    expect(world.events).toEqual([]);
  });
});
