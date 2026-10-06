import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine, type Plugin } from "claude-code/testing";
import type { ModEventsInput, ModEventsRecord } from "../types";
import { surfaceOf } from "./register.ts";

const ROOT = "/home/me/.claude/mod-events";

const PS_MOSH = [
  "    1     0 /sbin/launchd",
  " 1816     1 /opt/homebrew/bin/herdr",
  "56943     1 /opt/homebrew/bin/mosh-server",
  "56944 56943 herdr",
  " 1405     1 /Applications/Ghostty.app/Contents/MacOS/ghostty",
  "16760  1405 -zsh",
  "16774 16760 /opt/homebrew/bin/herdr",
].join("\n");

const HOME = { HOME: "/home/me" };

const CALLER: Plugin = {
  name: "caller",
  register(on) {
    on("turn.start", async ($, e, next) => {
      await $.modEvents.emit(JSON.parse(e.text));
      return next(e);
    });
  },
};
const WITH_CALLER = { plugins: [CALLER] };

const emit = ($: Engine, input: ModEventsInput) =>
  $.turn.start({ text: JSON.stringify(input), turnId: "t" });

function world(on: On, env: Record<string, string> = HOME, ps = "", isWritable = true) {
  const writes = new Map<string, string>();
  const clock = mock.clock(on, { now: 1000 });
  mock.env(on, env);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "s1" }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("fs.write", ($, e) => {
    if (!isWritable) throw new Error("EACCES");
    writes.set(e.path, e.text);
    return { value: undefined };
  });
  on("process.run", () => ({
    value: {
      exitCode: 0,
      stdout: ps,
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
  const lines = (path: string) =>
    (writes.get(path) ?? "")
      .split("\n")
      .filter((line) => line !== "")
      .map((line): ModEventsRecord => JSON.parse(line));
  return { writes, clock, lines };
}

describe("emit", () => {
  test("appends each event to the mod's chunk for the session", WITH_CALLER, async ($, on) => {
    const w = world(on);
    await emit($, {
      mod: "herdr",
      event: "herdr.call",
      ok: false,
      ms: 12,
      detail: { exitCode: 1 },
    });
    await w.clock.advance(5);
    await emit($, { mod: "herdr", event: "session.start" });

    expect([...w.writes.keys()]).toEqual([`${ROOT}/s1/herdr.1000.0.jsonl`]);
    expect(w.lines(`${ROOT}/s1/herdr.1000.0.jsonl`)).toEqual([
      {
        ts: 1000,
        session: "s1",
        mod: "herdr",
        event: "herdr.call",
        ok: false,
        ms: 12,
        detail: { exitCode: 1 },
      },
      {
        ts: 1005,
        session: "s1",
        mod: "herdr",
        event: "session.start",
        ok: true,
        ms: null,
        detail: {},
      },
    ]);
  });

  test("keeps each mod in its own file", WITH_CALLER, async ($, on) => {
    const w = world(on);
    await emit($, { mod: "herdr", event: "a" });
    await emit($, { mod: "run-command", event: "b" });
    expect([...w.writes.keys()].toSorted()).toEqual([
      `${ROOT}/s1/herdr.1000.0.jsonl`,
      `${ROOT}/s1/run-command.1000.0.jsonl`,
    ]);
  });

  test("starts a new chunk past 64 KB", WITH_CALLER, async ($, on) => {
    const w = world(on);
    const detail = { pad: "x".repeat(40 * 1024) };
    await emit($, { mod: "big", event: "a", detail });
    await emit($, { mod: "big", event: "b", detail });
    expect(w.lines(`${ROOT}/s1/big.1000.0.jsonl`).length).toBe(1);
    expect(w.lines(`${ROOT}/s1/big.1000.1.jsonl`).length).toBe(1);
  });

  test("writes under CLAUDE_CONFIG_DIR when set", WITH_CALLER, async ($, on) => {
    const w = world(on, { HOME: "/home/me", CLAUDE_CONFIG_DIR: "/cfg" });
    await emit($, { mod: "herdr", event: "a" });
    expect([...w.writes.keys()]).toEqual(["/cfg/mod-events/s1/herdr.1000.0.jsonl"]);
  });

  test("resolves when the write fails", WITH_CALLER, async ($, on) => {
    world(on, HOME, "", false);
    await expect(emit($, { mod: "herdr", event: "a" })).resolves.toEqual({ turnId: "t" });
  });
});

describe("session.start", () => {
  test("records the surface the session is reached from", async ($, on) => {
    const w = world(on, HOME, PS_MOSH);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(w.lines(`${ROOT}/s1/mod-events.1000.0.jsonl`)).toEqual([
      {
        ts: 1000,
        session: "s1",
        mod: "mod-events",
        event: "session.start",
        ok: true,
        ms: null,
        detail: {
          surface: "mosh",
          clients: ["local", "mosh"],
          surfaceKind: "terminal",
          isInteractive: true,
        },
      },
    ]);
  });
});

describe("surfaceOf", () => {
  test("mosh wins when any herdr client descends from mosh-server", () => {
    expect(surfaceOf(PS_MOSH, undefined)).toEqual({ surface: "mosh", clients: ["local", "mosh"] });
  });

  test("a session under ssh with no herdr is ssh", () => {
    expect(surfaceOf("", "10.0.0.2 5000 10.0.0.1 22")).toEqual({ surface: "ssh", clients: [] });
  });

  test("an sshd-launched herdr client is ssh", () => {
    const ps = [
      "1816 1 herdr",
      "900 1 sshd",
      "901 900 sshd-session",
      "902 901 -zsh",
      "903 902 herdr",
    ].join("\n");
    expect(surfaceOf(ps, undefined)).toEqual({ surface: "ssh", clients: ["ssh"] });
  });

  test("no ps output and no SSH_CONNECTION is local", () => {
    expect(surfaceOf(undefined, undefined)).toEqual({ surface: "local", clients: [] });
  });
});
