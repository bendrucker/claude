import type { EngineInterface, On, ProcessRunResult } from "claude-code";
import { type Engine, describe, expect, mock, test } from "claude-code/testing";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;
const ZSH = "5.9.2\non\noff\noff\non\n";

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
  test("reports the shell and its options at session start", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    expect(named(world, "session.start")).toEqual([
      {
        shell: "/bin/zsh",
        version: "5.9.2",
        active: true,
        nomatch: "on",
        nullglob: "off",
        cshnullglob: "off",
        equals: "on",
      },
    ]);
  });

  test("quotes what zsh would expand and records the rules", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    await bash($, "grep -rn register --include=*.ts plugins | head -2; echo ===");
    expect(world.ran).toEqual(["grep -rn register --include='*.ts' plugins | head -2; echo '==='"]);
    expect(named(world, "rewrite")).toEqual([{ rules: ["flag-glob", "equals"] }]);
  });

  test("passes a command with nothing to quote through unchanged", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran(ZSH));
    await $.session.start(START);
    await bash($, "ls -la 'src/*.ts'");
    expect(world.ran).toEqual(["ls -la 'src/*.ts'"]);
    expect(named(world, "rewrite")).toEqual([]);
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
    const world = worldOf(on, { SHELL: "/bin/bash" }, ran("\n\n\n\n\n"));
    await $.session.start(START);
    world.output = "(eval):1: no matches found: *.nope";
    const result = await bash($, "grep --include=*.ts x .; echo ===");
    expect(named(world, "session.start")[0]).toMatchObject({ shell: "/bin/bash", active: false });
    expect(world.ran).toEqual(["grep --include=*.ts x .; echo ==="]);
    expect(result.context).toBeUndefined();
    expect(named(world, "rewrite")).toEqual([]);
  });

  test("follows the user's options", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, ran("5.9.2\non\non\noff\non\n"));
    await $.session.start(START);
    await bash($, "grep --include=*.ts x .; echo ===");
    expect(world.ran).toEqual(["grep --include=*.ts x .; echo '==='"]);
  });

  test("falls back to zsh defaults when the probe fails", async ($, on) => {
    const world = worldOf(on, { SHELL: "/bin/zsh" }, new Error("timed out"));
    await $.session.start(START);
    await bash($, "echo ===");
    expect(world.ran).toEqual(["echo '==='"]);
    expect(named(world, "error")).toMatchObject([{ hook: "session.start", kind: "probe" }]);
  });
});
