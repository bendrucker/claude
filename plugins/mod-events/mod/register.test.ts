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
const RESOURCE = { "service.name": "claude-code", "service.version": "2.1.291" };

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
  const history: { path: string; text: string }[] = [];
  const clock = mock.clock(on, { now: 1000 });
  mock.env(on, env);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "s1" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("fs.write", ($, e) => {
    if (!isWritable) throw new Error("EACCES");
    writes.set(e.path, e.text);
    history.push({ path: e.path, text: e.text });
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
  return { writes, history, clock, lines };
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
        timestamp: "1970-01-01T00:00:01.000Z",
        severity_text: "WARN",
        severity_number: 13,
        event_name: "herdr.herdr.call",
        attributes: { exitCode: 1, duration_ms: 12, "session.id": "s1" },
        resource: RESOURCE,
        scope: { name: "herdr" },
      },
      {
        timestamp: "1970-01-01T00:00:01.005Z",
        severity_text: "INFO",
        severity_number: 9,
        event_name: "herdr.session.start",
        attributes: { "session.id": "s1" },
        resource: RESOURCE,
        scope: { name: "herdr" },
      },
    ]);
  });

  test("a detail cannot overwrite the session id", WITH_CALLER, async ($, on) => {
    const w = world(on);
    await emit($, { mod: "herdr", event: "a", detail: { "session.id": "other" } });
    expect(w.lines(`${ROOT}/s1/herdr.1000.0.jsonl`)[0]?.attributes["session.id"]).toBe("s1");
  });

  // A tailer such as the collector's filelog receiver fingerprints a file's first bytes and keeps a read offset.
  test(
    "each rewrite extends the last, and a rolled chunk is never written again",
    WITH_CALLER,
    async ($, on) => {
      const w = world(on);
      const detail = { pad: "x".repeat(30 * 1024) };
      for (const event of ["a", "b", "c", "d"]) {
        // oxlint-disable-next-line no-await-in-loop -- events land in order.
        await emit($, { mod: "big", event, detail });
      }
      const paths = w.history.map((write) => write.path);
      expect(paths).toEqual([
        `${ROOT}/s1/big.1000.0.jsonl`,
        `${ROOT}/s1/big.1000.0.jsonl`,
        `${ROOT}/s1/big.1000.1.jsonl`,
        `${ROOT}/s1/big.1000.1.jsonl`,
      ]);
      for (const [i, write] of w.history.entries()) {
        const previous = w.history.slice(0, i).findLast((earlier) => earlier.path === write.path);
        if (previous !== undefined) expect(write.text.startsWith(previous.text)).toBe(true);
      }
    },
  );

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
        timestamp: "1970-01-01T00:00:01.000Z",
        severity_text: "INFO",
        severity_number: 9,
        event_name: "mod-events.session.start",
        attributes: {
          clients: ["local", "mosh"],
          surfaceKind: "terminal",
          isInteractive: true,
          "session.id": "s1",
        },
        resource: { ...RESOURCE, "claude_code.surface": "mosh" },
        scope: { name: "mod-events" },
      },
    ]);
  });

  test("later events carry the surface on their resource", WITH_CALLER, async ($, on) => {
    const w = world(on, HOME, PS_MOSH);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    await emit($, { mod: "herdr", event: "a" });
    expect(w.lines(`${ROOT}/s1/herdr.1000.0.jsonl`)[0]?.resource).toEqual({
      ...RESOURCE,
      "claude_code.surface": "mosh",
    });
  });
});

describe("surfaceOf", () => {
  test("mosh wins when any herdr client descends from mosh-server", () => {
    expect(surfaceOf(PS_MOSH, undefined)).toEqual({ surface: "mosh", clients: ["local", "mosh"] });
  });

  test("a session under ssh with no herdr is ssh", () => {
    expect(surfaceOf("", "10.0.0.2 5000 10.0.0.1 22")).toEqual({ surface: "ssh", clients: [] });
  });

  test("herdr's clients outrank an SSH_CONNECTION the server passed its panes", () => {
    const ps = ["    1     0 /sbin/launchd", " 1816     1 herdr", "16774  1405 herdr"].join("\n");
    expect(surfaceOf(ps, "10.0.0.2 5000 10.0.0.1 22")).toEqual({
      surface: "local",
      clients: ["local"],
    });
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
