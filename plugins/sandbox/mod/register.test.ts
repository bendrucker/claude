import type { EngineInterface, On } from "claude-code";
import { type Engine, describe, expect, test } from "claude-code/testing";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

interface World {
  /** Each source's settings. */
  settings: Record<string, Record<string, unknown>> | Error;
  ran: string[];
  events: ModEventsInput[];
}

function worldOf(on: On): World {
  const world: World = {
    settings: {
      local: { sandbox: { enabled: true } },
      user: { sandbox: { excludedCommands: ["git:*", "agent-browser:*"] } },
    },
    ran: [],
    events: [],
  };
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => (world.events.push(e), { value: undefined }));
  on("settings.read", ($, e) => {
    if (world.settings instanceof Error) throw world.settings;
    return { value: world.settings[e.source ?? ""] ?? {} };
  });
  on("session.cwd", () => ({ value: "/repo" }));
  on("tool.call", ($, e) => {
    if (e.tool === "Bash") world.ran.push(e.command);
    return { result: "ok" };
  });
  return world;
}

const bypass = ($: Engine, command: string, agentId?: string) =>
  // The engine sets agentId from the loop. The kit's call type leaves it out.
  $.tool.call({
    tool: "Bash",
    command,
    dangerouslyDisableSandbox: true,
    tool_use_id: "toolu_1",
    ...(agentId && { agentId }),
  });

describe("register", () => {
  test("runs a scaffolded bypass, reminds of the escaping form, and records it", async ($, on) => {
    const world = worldOf(on);

    const result = await bypass($, "cd /repo && git push 2>&1 | tail -5");
    expect(result.deny).toBeUndefined();
    expect(result.context?.join("\n")).toContain("    git push");
    expect(world.ran).toEqual(["cd /repo && git push 2>&1 | tail -5"]);
    expect(world.events).toEqual([
      {
        mod: "sandbox",
        event: "bypass",
        detail: {
          verdict: "remind",
          reason: null,
          scaffolds: ["cd", "redirect", "filter"],
          verbs: ["git"],
          agent: null,
          repeat: 0,
        },
      },
    ]);
  });

  test("counts reminders per loop", async ($, on) => {
    const world = worldOf(on);

    await bypass($, "git status");
    await bypass($, "git status");
    await bypass($, "git status", "a1");
    expect(world.events.map((e) => e.detail?.repeat)).toEqual([0, 1, 0]);
  });

  test("lets a bypass with no escaping form run and records why", async ($, on) => {
    const world = worldOf(on);

    const result = await bypass($, "git status && bun test");
    expect(result.context).toBeUndefined();
    expect(world.ran).toEqual(["git status && bun test"]);
    expect(world.events[0]?.detail).toMatchObject({ verdict: "allow", reason: "unmatched" });
  });

  test("keeps a subagent's cd, whose shell may start in its own worktree", async ($, on) => {
    const world = worldOf(on);

    const command = "cd /repo && git status";
    const result = await bypass($, command, "a1");
    expect(result.context).toBeUndefined();
    expect(world.ran).toEqual([command]);
    expect(world.events[0]?.detail).toMatchObject({ reason: "cd-elsewhere", agent: "a1" });
  });

  test("ignores a call without the flag", async ($, on) => {
    const world = worldOf(on);

    await $.tool.call({ tool: "Bash", command: "git status", tool_use_id: "toolu_1" });
    expect(world.ran).toEqual(["git status"]);
    expect(world.events).toEqual([]);
  });

  test("reads excludedCommands from every source, and none while the sandbox is off", async ($, on) => {
    const world = worldOf(on);

    world.settings = {
      local: { sandbox: { enabled: true } },
      user: { sandbox: { excludedCommands: ["git:*"] } },
      project: { sandbox: { excludedCommands: ["ssh:*"] } },
    };
    const note = async (command: string) => (await bypass($, command)).context?.join("\n");
    expect(await note("git status")).toContain("`git:*`");
    expect(await note("ssh vm uptime")).toContain("`ssh:*`");
    expect(await note("aws s3 ls")).toBeUndefined();

    world.settings = {
      user: { sandbox: { enabled: true, excludedCommands: ["ssh:*"] } },
      local: { sandbox: { enabled: false } },
    };
    expect(await note("ssh vm uptime")).toBeUndefined();
    world.settings = { project: { sandbox: { excludedCommands: ["ssh:*"] } } };
    expect(await note("ssh vm uptime")).toBeUndefined();
    expect(world.ran).toHaveLength(5);
  });

  test("fails open when the settings cannot be read", async ($, on) => {
    const world = worldOf(on);
    world.settings = new Error("unreadable");

    const result = await bypass($, "git status");
    expect(result.context).toBeUndefined();
    expect(world.ran).toEqual(["git status"]);
    expect(world.events.map((e) => e.event)).toEqual(["error"]);
  });
});
