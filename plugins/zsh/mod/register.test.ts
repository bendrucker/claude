import type { EngineInterface, On, ProcessRunResult } from "claude-code";
import { type Engine, describe, expect, mock, test } from "claude-code/testing";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const ZSH = "5.9.2\n";

function ran(stdout: string, exitCode = 0): ProcessRunResult {
  return { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false };
}

interface World {
  /** What the Bash tool prints for the command it receives. */
  output: string;
  ran: string[];
  events: ModEventsInput[];
}

function worldOf(on: On, env: Record<string, string>, probe: ProcessRunResult | Error): World {
  const world: World = { output: "", ran: [], events: [] };
  mock.env(on, env);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => (world.events.push(e), { value: undefined }));
  on("process.run", () => {
    if (probe instanceof Error) throw probe;
    return { value: probe };
  });
  on("tool.call", ($, e) => {
    if (e.tool === "Bash") world.ran.push(e.command);
    return { result: world.output, text: world.output };
  });
  return world;
}

const bash = ($: Engine, command: string) =>
  $.tool.call({ tool: "Bash", command, tool_use_id: "toolu_1" });

const named = (world: World, event: string) =>
  world.events.filter((e) => e.event === event).map((e) => e.detail);

describe("register", () => {
  test("reports the shell at session start", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    expect(named(world, "session.start")).toEqual([
      { shell: "/bin/zsh", version: "5.9.2", active: true },
    ]);
  });

  test("runs a command with unquoted patterns as written", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    const result = await bash($, "grep -rn register --include=*.ts plugins | head -2; echo ===");
    expect(world.ran).toEqual(["grep -rn register --include=*.ts plugins | head -2; echo ==="]);
    expect(result.deny).toBeUndefined();
  });

  test("notes a zsh error after the result, in full once and briefly after", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    world.output = "(eval):1: no matches found: plugins/zsh/*.nope";
    const first = await bash($, "ls plugins/zsh/*.nope");
    const second = await bash($, "ls plugins/zsh/*.nope");
    const [full] = first.context ?? [];
    const [brief] = second.context ?? [];
    expect(full).toContain("plugins/zsh/*.nope");
    expect(brief?.length).toBeLessThan(full?.length ?? 0);
    expect(named(world, "explain")).toEqual([
      { class: "glob", repeat: false },
      { class: "glob", repeat: true },
    ]);
  });

  test("adds no context to a clean result", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    world.output = "ok";
    const result = await bash($, "ls");
    expect(result.context).toBeUndefined();
  });

  test("stays inert under bash", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/bash" }, ran("\n"));
    await $.session.start(START);
    world.output = "(eval):1: no matches found: *.nope";
    const result = await bash($, "ls *.nope");
    expect(named(world, "session.start")[0]).toMatchObject({ shell: "/bin/bash", active: false });
    expect(result.context).toBeUndefined();
    expect(named(world, "explain")).toEqual([]);
  });

  test("still notes zsh errors when the probe fails", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, new Error("timed out"));
    await $.session.start(START);
    world.output = "(eval):1: no matches found: *.nope";
    const result = await bash($, "ls *.nope");
    expect(result.context).toHaveLength(1);
    expect(named(world, "error")).toMatchObject([{ hook: "session.start", kind: "probe" }]);
  });

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const [reason, repeat] of [
    ["clear", false],
    ["resume", false],
    ["prompt_input_exit", true],
  ] as const) {
    test(`after a session ends on ${reason}, a repeat note is brief: ${repeat}`, async ($, on) => {
      const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
      on("session.end", (_, e) => ({ sessionId: e.sessionId }));
      await $.session.start(START);
      world.output = "(eval):1: no matches found: plugins/zsh/*.nope";
      await bash($, "ls plugins/zsh/*.nope");
      await $.session.end({ reason, sessionId: "s1", resume: { id: "s1" } });
      await bash($, "ls plugins/zsh/*.nope");
      expect(named(world, "explain")).toEqual([
        { class: "glob", repeat: false },
        { class: "glob", repeat },
      ]);
    });
  }
});
