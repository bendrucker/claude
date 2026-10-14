import type { EngineInterface, On, ToolCallResult } from "claude-code";

import { type Engine, describe, expect, test, tier } from "claude-code/testing";

import { type Command, commandOf, denyReason } from "./register";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

tier("user");

interface World {
  events: ModEventsInput[];
  ran: string[];
}

function worldOf(on: On, failing = new Set<string>()): World {
  const world: World = { events: [], ran: [] };
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => (world.events.push(e), { value: undefined }));
  on("tool.call", ($, e): ToolCallResult => {
    if (e.tool !== "Bash") return { result: "ok" };
    world.ran.push(e.command);
    return failing.has(e.command) ? { isError: true, result: "boom" } : { result: "ok" };
  });
  return world;
}

let id = 0;

function bash($: Engine, command: string, bypass = false): Promise<ToolCallResult> {
  id += 1;
  return $.tool.call({
    tool: "Bash",
    command,
    tool_use_id: `toolu_${id}`,
    dangerouslyDisableSandbox: bypass,
  });
}

function eventsOf(world: World): unknown[] {
  return world.events.map(({ event, ok, detail }) => [event, ok, detail?.verb]);
}

describe("commandOf", () => {
  const CASES: [string, Command | undefined][] = [
    ["gh pr view 1", { verb: "gh", subcommand: "pr" }],
    ["  FOO=1 BAR=2 bun test", { verb: "bun", subcommand: "test" }],
    ["cd plugins && sed -n 1p x", { verb: "sed", subcommand: "-n" }],
    ["env NODE_ENV=test nohup /usr/bin/python3 -c 1", { verb: "python3", subcommand: "-c" }],
    ["ls", { verb: "ls", subcommand: undefined }],
    ['FOO="a b" bun install', { verb: "bun", subcommand: "install" }],
    ["env -i PATH=/bin bun install", { verb: "bun", subcommand: "install" }],
    ["cd x 2>&1 && gh pr view", { verb: "gh", subcommand: "pr" }],
    ["cd 'a;b' && sed -n 1p x", { verb: "sed", subcommand: "-n" }],
    ['echo "a && b"', { verb: "echo", subcommand: "a && b" }],
    ["cd somewhere", undefined],
    ["", undefined],
  ];

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const [command, want] of CASES) {
    test(JSON.stringify(command), () => {
      expect(commandOf(command)).toEqual(want);
    });
  }
});

describe("register", () => {
  test("denies a bypass before the verb has failed sandboxed", async ($, on) => {
    const world = worldOf(on);

    expect(await bash($, "gh pr view 1", true)).toEqual({ deny: denyReason("gh") });

    expect(world.ran).toEqual([]);
    expect(world.events).toEqual([
      { mod: "mac", event: "bypass.deny", detail: { verb: "gh", agent_id: null, repeat: false } },
    ]);
  });

  test("records a successful sandboxed retry of the denied command", async ($, on) => {
    const world = worldOf(on);

    await bash($, "gh pr view 1", true);
    await bash($, "gh pr view 1", true);
    await bash($, "gh pr view 2");
    await bash($, "gh pr view 1");
    await bash($, "gh pr view 1");

    expect(world.ran).toEqual(["gh pr view 2", "gh pr view 1", "gh pr view 1"]);
    expect(world.events.map((e) => [e.event, e.ok, e.detail?.repeat])).toEqual([
      ["bypass.deny", undefined, false],
      ["bypass.deny", undefined, true],
      ["bypass.retry", true, undefined],
    ]);
  });

  test("records a failed sandboxed retry, then allows the bypass", async ($, on) => {
    const world = worldOf(on, new Set(["mkdir ~/x"]));

    await bash($, "mkdir ~/x", true);
    await bash($, "mkdir ~/x");
    expect(await bash($, "mkdir ~/x", true)).toEqual({ isError: true, result: "boom" });

    expect(world.ran).toEqual(["mkdir ~/x", "mkdir ~/x"]);
    expect(eventsOf(world)).toEqual([
      ["bypass.deny", undefined, "mkdir"],
      ["bypass.retry", false, "mkdir"],
      ["bypass.allow", undefined, "mkdir"],
    ]);
  });

  test("allows a bypass for a verb that failed sandboxed without a deny", async ($, on) => {
    const world = worldOf(on, new Set(["bun test"]));

    await bash($, "bun test");
    await bash($, "bun scripts/x.ts", true);

    expect(world.ran).toEqual(["bun test", "bun scripts/x.ts"]);
    expect(world.events).toEqual([
      {
        mod: "mac",
        event: "bypass.allow",
        detail: { verb: "bun", agent_id: null, reason: "failed" },
      },
    ]);
  });

  test("a failure of another verb does not unlock the bypass", async ($, on) => {
    const world = worldOf(on, new Set(["sed -n 1p x"]));

    await bash($, "sed -n 1p x");

    expect(await bash($, "python3 x.py", true)).toEqual({ deny: denyReason("python3") });
    expect(world.ran).toEqual(["sed -n 1p x"]);
  });

  test("exempts bun install", async ($, on) => {
    const world = worldOf(on);

    await bash($, "bun install --frozen-lockfile", true);
    await bash($, "bun i", true);

    expect(world.ran).toEqual(["bun install --frozen-lockfile", "bun i"]);
    expect(world.events.map((e) => e.detail?.reason)).toEqual(["exempt", "exempt"]);
  });

  test("a sandboxed run with no pending deny emits nothing", async ($, on) => {
    const world = worldOf(on, new Set(["false"]));

    await bash($, "ls");
    await bash($, "false");

    expect(world.events).toEqual([]);
  });
});
