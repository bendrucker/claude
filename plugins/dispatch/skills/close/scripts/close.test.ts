import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { CommandResult, Runner, RunOptions } from "../../dispatch/scripts/dispatch";
import {
  appendDispatch,
  type ClosedRow,
  type DispatchLedgerRow,
  ledgerPath,
  readLedger,
} from "../../dispatch/scripts/ledger";
import {
  attachSession,
  closeSession,
  createProgram,
  type Deps,
  defaultDeps,
  parkSession,
  relocateSession,
  restoreSession,
} from "./close";
import { CloseError } from "./errors";
import { hostMuxer } from "./muxers";
import { recordEnded, reopenSession, resumerLog, resumeSession } from "./resume";
import { closedRows, leftBehind } from "./rows";

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string, code = 1): CommandResult => ({ code, stdout: "", stderr });

interface Call {
  argv: string[];
  options: RunOptions | undefined;
}

function scripted(answers: Record<string, CommandResult>): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = (argv, options) => {
    calls.push({ argv: [...argv], options });
    const key = Object.keys(answers)
      .filter((prefix) => argv.join(" ").startsWith(prefix))
      .toSorted((a, b) => b.length - a.length)[0];
    return Promise.resolve(key == null ? ok() : (answers[key] ?? ok()));
  };
  return { run, calls };
}

const GIT = {
  "git rev-parse --show-toplevel": ok("/work/tree\n"),
  "git branch --show-current": ok("feature\n"),
  "git rev-parse HEAD": ok("abc123\n"),
  "git status --porcelain": ok(" M a.ts\n?? b.ts\n"),
  "git rev-list --count": ok("2\n"),
};

const FORK = "bg-1234";

const RESUMER = 4242;

interface Spawned {
  argv: string[];
  cwd: string;
  logPath: string;
}

const REX_ENV = { REX_SESSION: "main", REX_BLOCK: "block:7" };
const HERDR_ENV = { HERDR_ENV: "1", HERDR_PANE_ID: "pane-9" };

function makeDeps(
  answers: Record<string, CommandResult>,
  env: Record<string, string | undefined>,
  sender: string | null = null,
): {
  deps: Deps;
  calls: Call[];
  out: string[];
  dataDir: string;
  spawned: Spawned[];
  killed: number[];
} {
  const { run, calls } = scripted({ ...GIT, ...answers });
  const out: string[] = [];
  const spawned: Spawned[] = [];
  const killed: number[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "close-test-"));
  const deps: Deps = {
    run,
    env,
    cwd: "/work/tree",
    dataDir,
    now: () => new Date("2026-11-03T12:00:00.000Z"),
    wait: () => Promise.resolve(),
    out: (line) => {
      out.push(line);
    },
    sender: () => Promise.resolve(sender == null ? null : { name: sender, mux: null }),
    spawnDetached: (argv, cwd, logPath) => {
      spawned.push({ argv: [...argv], cwd, logPath });
      return Promise.resolve(RESUMER);
    },
    alive: () => false,
    kill: (pid) => {
      killed.push(pid);
    },
  };
  return { deps, calls, out, dataDir, spawned, killed };
}

const argvs = (calls: Call[]): string[] => calls.map((call) => call.argv.join(" "));

async function failureOf(attempt: Promise<unknown>): Promise<CloseError> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof CloseError) return error;
    throw error;
  }
  throw new Error("expected a CloseError");
}

function dispatchRow(overrides: Partial<DispatchLedgerRow> = {}): DispatchLedgerRow {
  return {
    ts: "2026-11-03T10:00:00.000Z",
    task: "t",
    repo: "r",
    branch: "child-branch",
    path: "/work/child",
    mux: "rex",
    target: "block:child",
    host: null,
    name: "child",
    session: null,
    sender: "parent",
    outcome: "dispatched",
    ...overrides,
  };
}

function closedRow(overrides: Partial<ClosedRow> = {}): ClosedRow {
  return {
    event: "closed",
    ts: "2026-11-03T11:00:00.000Z",
    session: "s",
    fork: null,
    branch: "b",
    path: "/p",
    head: "abc",
    dirty: 0,
    ahead: 0,
    pr: null,
    mux: "rex",
    target: "block:1",
    summary: null,
    ...overrides,
  };
}

describe("hostMuxer", () => {
  const ownPane = (env: Record<string, string>) => {
    const host = hostMuxer({ env, cwd: "/", run: scripted({}).run });
    return { mux: host.kind, target: host.ownPane() };
  };

  test("rex uses the session and block", () => {
    expect(ownPane(REX_ENV)).toEqual({ mux: "rex", target: "block:7" });
  });

  test("herdr uses the pane id", () => {
    expect(ownPane(HERDR_ENV)).toEqual({ mux: "herdr", target: "pane-9" });
  });

  test("the herdr App is refused with exit 2", () => {
    try {
      ownPane({ HC_TERMINAL_ID: "t1" });
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(CloseError);
      expect(error).toMatchObject({ exitCode: 2 });
      expect(String(error)).toContain("herdr App");
    }
  });

  test("no multiplexer is refused", () => {
    expect(() => ownPane({})).toThrow(CloseError);
  });
});

describe("closeSession", () => {
  test("rex closes its own block after writing the row and the report", async () => {
    const { deps, calls, out, dataDir } = makeDeps({}, REX_ENV);
    const report = await closeSession({ summary: "done" }, deps);
    expect(argvs(calls).at(-1)).toBe("rex block close -s main block:7");
    expect(report.row).toMatchObject({
      event: "closed",
      branch: "feature",
      path: "/work/tree",
      head: "abc123",
      dirty: 2,
      ahead: 2,
      mux: "rex",
      target: "block:7",
      summary: "done",
      fork: null,
    });
    expect(readLedger(dataDir)).toEqual([report.row]);
    expect(JSON.parse(out[0] ?? "")).toMatchObject({ pane: { target: "block:7" } });
  });

  test("the row and report exist before the close call runs", async () => {
    const { deps, dataDir, out } = makeDeps({}, HERDR_ENV);
    const seen: { rows: number; out: number }[] = [];
    const inner = deps.run;
    deps.run = (argv, options) => {
      if (argv[0] === "herdr") seen.push({ rows: readLedger(dataDir).length, out: out.length });
      return inner(argv, options);
    };
    await closeSession({}, deps);
    expect(seen).toEqual([{ rows: 1, out: 1 }]);
  });

  test("herdr closes the pane and never passes --group", async () => {
    const { deps, calls } = makeDeps({}, HERDR_ENV);
    await closeSession({}, deps);
    expect(argvs(calls).at(-1)).toBe("herdr pane close pane-9");
    expect(argvs(calls).join(" ")).not.toContain("--group");
  });

  test("a herdr group conflict leaves the pane open and exits 1", async () => {
    const { deps } = makeDeps(
      { "herdr pane close": fail('{"error":{"code":"workspace_group_close_required"}}') },
      HERDR_ENV,
    );
    const error = await failureOf(closeSession({}, deps));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain("linked worktree group");
  });

  test("confirmation_required is a group conflict too", async () => {
    const { deps } = makeDeps({ "herdr pane close": ok("confirmation_required") }, HERDR_ENV);
    expect((await failureOf(closeSession({}, deps))).message).toContain("linked worktree group");
  });

  test("outside git the facts are null", async () => {
    const { deps } = makeDeps(
      { "git rev-parse --show-toplevel": fail("not a repo", 128) },
      REX_ENV,
    );
    const { row } = await closeSession({}, deps);
    expect(row).toMatchObject({ branch: null, path: null, head: null, dirty: null, ahead: null });
  });

  test("no upstream counts the commits missing from every remote", async () => {
    const { deps } = makeDeps(
      {
        "git rev-list --count @{u}..HEAD": fail("no upstream", 128),
        "git rev-list --count HEAD --not --remotes": ok("3\n"),
      },
      REX_ENV,
    );
    expect((await closeSession({}, deps)).row.ahead).toBe(3);
  });

  test("ahead is null when neither count runs", async () => {
    const { deps } = makeDeps({ "git rev-list --count": fail("no upstream", 128) }, REX_ENV);
    expect((await closeSession({}, deps)).row.ahead).toBeNull();
  });

  test("--handoff with --target is invalid", async () => {
    const { deps } = makeDeps({}, REX_ENV, "parent");
    const error = await failureOf(
      closeSession({ handoff: true, target: "child", session: "s", pr: "u" }, deps),
    );
    expect(error.exitCode).toBe(2);
  });

  test("--handoff requires a session and a PR", async () => {
    const { deps } = makeDeps({}, REX_ENV);
    expect((await failureOf(closeSession({ handoff: true }, deps))).exitCode).toBe(2);
  });
});

describe("closeSession --handoff", () => {
  const options = { handoff: true, session: "sess-1", pr: "https://github.com/o/r/pull/1" };
  const env = { ...REX_ENV, CLAUDE_PID: "9" };

  test("starts a resumer that waits on this session's process, then records and closes", async () => {
    const { deps, calls, dataDir, spawned } = makeDeps({}, env);
    const report = await closeSession(options, deps);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.argv.slice(2)).toEqual([
      "resume",
      "--session",
      "sess-1",
      "--pr",
      options.pr,
      "--pid",
      "9",
    ]);
    expect(spawned[0]?.cwd).toBe("/work/tree");
    expect(spawned[0]?.logPath).toBe(resumerLog(dataDir, "sess-1"));
    expect(argvs(calls).some((line) => line.startsWith("claude"))).toBe(false);
    expect(argvs(calls).at(-1)).toBe("rex block close -s main block:7");
    expect(report).toMatchObject({ fork: "sess-1", resumer: RESUMER });
    expect(readLedger(dataDir)).toMatchObject([{ fork: "sess-1", pr: options.pr }]);
  });

  test.each([undefined, "", "abc", "0", "1.5"])(
    "refuses CLAUDE_PID %p and starts nothing",
    async (pid) => {
      const { deps, calls, dataDir, spawned } = makeDeps({}, { ...REX_ENV, CLAUDE_PID: pid });
      expect((await failureOf(closeSession(options, deps))).exitCode).toBe(2);
      expect(spawned).toEqual([]);
      expect(readLedger(dataDir)).toEqual([]);
      expect(argvs(calls).some((line) => line.startsWith("rex block close"))).toBe(false);
    },
  );

  test("a refused close kills the resumer and records it ended", async () => {
    const { deps, dataDir, killed } = makeDeps(
      { "herdr pane close": fail("workspace_group_close_required") },
      { ...HERDR_ENV, CLAUDE_PID: "9" },
    );
    await failureOf(closeSession(options, deps));
    expect(killed).toEqual([RESUMER]);
    expect(readLedger(dataDir)).toMatchObject([
      { event: "closed", fork: "sess-1" },
      { event: "ended", fork: "sess-1", outcome: "stopped" },
    ]);
  });

  test("a failed kill after a refused close says to kill the resumer by hand", async () => {
    const { deps } = makeDeps(
      { "herdr pane close": fail("workspace_group_close_required") },
      { ...HERDR_ENV, CLAUDE_PID: "9" },
    );
    deps.kill = () => {
      throw new Error("ESRCH");
    };
    expect((await failureOf(closeSession(options, deps))).message).toContain(`${RESUMER} by hand`);
  });
});

async function written(path: string, attempts = 100): Promise<string> {
  const file = Bun.file(path);
  const text = (await file.exists()) ? (await file.text()).trim() : "";
  if (text !== "" || attempts <= 1) return text;
  await Bun.sleep(20);
  return written(path, attempts - 1);
}

describe("spawnDetached", () => {
  test("returns the pid of the backgrounded command and appends its output to the log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "close-spawn-"));
    const log = join(dir, "resume.log");
    const pid = await defaultDeps().spawnDetached(["sh", "-c", "echo $$"], dir, log);
    expect(await written(log)).toBe(String(pid));
  });
});

describe("resumeSession", () => {
  const options = { session: "sess-1", pr: "https://github.com/o/r/pull/1", pid: 9 };
  const SAME = ok("backgrounded · sess-1\n  claude attach sess-1\n");

  test("waits for the process to exit, then resumes under the same id with a detached env", async () => {
    const { deps, calls, dataDir } = makeDeps(
      { "claude --bg": SAME },
      { CLAUDE_PID: "9", CLAUDE_CODE_SSE_PORT: "1" },
    );
    let checks = 0;
    deps.alive = (pid) => {
      expect(pid).toBe(9);
      return ++checks < 3;
    };
    expect(await resumeSession(options, deps)).toBe("sess-1");
    expect(checks).toBe(3);
    const bg = calls.find((call) => call.argv[1] === "--bg");
    expect(bg?.argv.slice(0, 4)).toEqual(["claude", "--bg", "--resume", "sess-1"]);
    expect(bg?.argv[4]).toContain("background.md");
    expect(bg?.argv[4]).toContain(options.pr);
    expect(bg?.options?.env).toMatchObject({
      CLAUDE_PID: undefined,
      CLAUDE_CODE_SSE_PORT: undefined,
    });
    expect(readLedger(dataDir)).toEqual([]);
  });

  test("gives up on a process that never exits and records it", async () => {
    const { deps, calls, dataDir } = makeDeps({}, {});
    deps.alive = () => true;
    expect((await failureOf(resumeSession(options, deps))).message).toContain("still running");
    expect(argvs(calls).some((line) => line.startsWith("claude"))).toBe(false);
    expect(readLedger(dataDir)).toMatchObject([
      { event: "ended", fork: "sess-1", outcome: "stopped", branch: "feature" },
    ]);
  });

  test("records a failed claude --bg", async () => {
    const { deps, dataDir } = makeDeps({ "claude --bg": fail("daemon down") }, {});
    await failureOf(resumeSession(options, deps));
    expect(JSON.stringify(readLedger(dataDir).at(-1))).toContain("daemon down");
  });

  test("records output with no background id", async () => {
    const { deps, dataDir } = makeDeps({ "claude --bg": ok("started\nbut no id\n") }, {});
    await failureOf(resumeSession(options, deps));
    expect(JSON.stringify(readLedger(dataDir).at(-1))).toContain("no background session id");
  });
});

describe("closeSession --target", () => {
  test("refuses a pane the caller did not dispatch", async () => {
    const { deps, dataDir, calls } = makeDeps({}, REX_ENV, "someone-else");
    appendDispatch(dispatchRow(), dataDir);
    const error = await failureOf(closeSession({ target: "child" }, deps));
    expect(error.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  test("refuses an unknown name", async () => {
    const { deps } = makeDeps({}, REX_ENV, "parent");
    expect((await failureOf(closeSession({ target: "ghost" }, deps))).exitCode).toBe(2);
  });

  test("refuses when the session has no registered name", async () => {
    const { deps, dataDir } = makeDeps({}, REX_ENV, null);
    appendDispatch(dispatchRow({ sender: null }), dataDir);
    await failureOf(closeSession({ target: "child" }, deps));
  });

  test("refuses a dispatch that failed", async () => {
    const { deps, dataDir } = makeDeps({}, REX_ENV, "parent");
    appendDispatch(dispatchRow({ outcome: "failed" }), dataDir);
    await failureOf(closeSession({ target: "child" }, deps));
  });

  test("closes the latest matching rex child with facts from its worktree", async () => {
    const { deps, dataDir, calls } = makeDeps({}, REX_ENV, "parent");
    appendDispatch(dispatchRow({ target: "block:old" }), dataDir);
    appendDispatch(dispatchRow({ target: "block:new" }), dataDir);
    const { row } = await closeSession({ target: "child" }, deps);
    expect(argvs(calls).at(-1)).toBe("rex block close -s main block:new");
    expect(calls[0]?.options?.cwd).toBe("/work/child");
    expect(row.target).toBe("block:new");
  });

  test("refuses a child whose pane was already closed", async () => {
    const { deps, dataDir, calls } = makeDeps({}, REX_ENV, "parent");
    appendDispatch(dispatchRow(), dataDir);
    appendDispatch(closedRow({ mux: "rex", target: "block:child" }), dataDir);
    expect((await failureOf(closeSession({ target: "child" }, deps))).exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  test("closes a herdr child by its pane id", async () => {
    const { deps, dataDir, calls } = makeDeps({}, HERDR_ENV, "parent");
    appendDispatch(dispatchRow({ mux: "herdr", target: "pane-child" }), dataDir);
    await closeSession({ target: "child" }, deps);
    expect(argvs(calls).at(-1)).toBe("herdr pane close pane-child");
  });
});

function windowWith(...layers: { id: string; kind: string; state?: string; blocks: string[] }[]) {
  return ok(
    JSON.stringify({
      window_id: "window:1",
      layers: layers.map((layer) => ({
        layer_id: layer.id,
        kind: layer.kind,
        state: layer.state ?? null,
        blocks: layer.blocks.map((block_id) => ({ block_id })),
      })),
    }),
  );
}

const REX_LAYERS = (window: CommandResult) => ({
  "rex block inspect": ok(JSON.stringify({ block: { window_id: "window:1" } })),
  "rex window inspect": window,
  "rex api call -s main session.float_block": ok('{"layer_id":"layer:float","revision":3}'),
  "rex api call -s main session.set_layer_state": ok('{"revision":4}'),
});

const PARK = { session: "sess-1", pr: "https://github.com/o/r/pull/1", summary: "done" };

describe("relocateSession", () => {
  const options = { session: "sess-1", to: "other" };
  const env = { ...REX_ENV, CLAUDE_PID: "9" };
  const REX = {
    "rex api call target.resolve": ok(
      JSON.stringify({
        results: [
          {
            status: "resolved",
            target: { kind: "session", session_id: "session:b", label: "other" },
          },
        ],
      }),
    ),
    "rex block inspect": ok(JSON.stringify({ block: { window_id: "window:1" } })),
    "rex window inspect": ok(JSON.stringify({ label: "My Task", layers: [] })),
  };

  test("starts a reopener for the target session, records the move, and closes the pane", async () => {
    const { deps, calls, dataDir, spawned } = makeDeps(REX, env);
    const report = await relocateSession(options, deps);
    expect(spawned[0]?.argv.slice(2)).toEqual([
      "reopen",
      "--session",
      "sess-1",
      "--pid",
      "9",
      "--to",
      "session:b",
      "--label",
      "My Task",
      "--cwd",
      "/work/tree",
    ]);
    expect(spawned[0]?.logPath).toBe(resumerLog(dataDir, "sess-1"));
    expect(argvs(calls).at(-1)).toBe("rex block close -s main block:7");
    expect(report).toMatchObject({ resumer: RESUMER, label: "My Task" });
    expect(readLedger(dataDir)).toMatchObject([
      { event: "relocated", session: "sess-1", to: "other", mux: "rex", target: "block:7" },
    ]);
  });

  test("an unknown target fails before starting anything", async () => {
    const { deps, calls, dataDir, spawned } = makeDeps(
      {
        ...REX,
        "rex api call target.resolve": ok(
          JSON.stringify({ results: [{ query: "other", status: "not_found" }] }),
        ),
      },
      env,
    );
    const error = await failureOf(relocateSession(options, deps));
    expect(error).toMatchObject({ exitCode: 2, message: "Rex session other was not found" });
    expect(spawned).toEqual([]);
    expect(readLedger(dataDir)).toEqual([]);
    expect(argvs(calls).some((line) => line.startsWith("rex block close"))).toBe(false);
  });

  test.each([
    ["herdr", { ...HERDR_ENV, CLAUDE_PID: "9" }],
    ["bg", { CLAUDE_PID: "9" }],
  ])("refuses under %s", async (_, muxEnv) => {
    const { deps, spawned } = makeDeps(REX, muxEnv);
    const error = await failureOf(relocateSession(options, deps));
    expect(error.message).toContain("not running in Rex");
    expect(spawned).toEqual([]);
  });

  test("a failed close kills the reopener and records it ended", async () => {
    const { deps, dataDir, killed } = makeDeps({ ...REX, "rex block close": fail("gone") }, env);
    await failureOf(relocateSession(options, deps));
    expect(killed).toEqual([RESUMER]);
    expect(readLedger(dataDir)).toMatchObject([
      { event: "relocated" },
      { event: "ended", outcome: "stopped" },
    ]);
  });
});

describe("reopenSession", () => {
  const options = { session: "sess-1", pid: 9, to: "session:b", label: "My Task", cwd: "/w" };

  test("opens a tab resuming the session once its process exits", async () => {
    const { deps, calls } = makeDeps(
      { "rex window new": ok(JSON.stringify({ block_ids: ["block:new"] })) },
      REX_ENV,
    );
    expect(await reopenSession(options, deps)).toBe("block:new");
    expect(argvs(calls)).toEqual([
      "rex window new -s session:b My Task -c /w --focus=false --json -- claude --resume sess-1",
    ]);
  });

  test("gives up while the process still runs", async () => {
    const { deps, calls } = makeDeps({}, REX_ENV);
    deps.alive = () => true;
    expect((await failureOf(reopenSession(options, deps))).message).toContain("still running");
    expect(calls).toEqual([]);
  });

  test("reports a failed rex window new", async () => {
    const { deps } = makeDeps({ "rex window new": fail("no such session") }, REX_ENV);
    expect((await failureOf(reopenSession(options, deps))).message).toContain("no such session");
  });
});

describe("parkSession", () => {
  test("rex floats a tiled block, minimizes its layer, and records a parked row", async () => {
    const { deps, calls, dataDir } = makeDeps(
      REX_LAYERS(windowWith({ id: "layer:tiled", kind: "tiled", blocks: ["block:7", "block:8"] })),
      REX_ENV,
    );
    const report = await parkSession(PARK, deps);
    expect(argvs(calls).filter((line) => line.startsWith("rex"))).toEqual([
      "rex block inspect -s main block:7 --json",
      "rex window inspect -s main window:1 --json",
      'rex api call -s main session.float_block {"block_id":"block:7","bounds":[0.2,0.15,0.6,0.7]}',
      'rex api call -s main session.set_layer_state {"layer_id":"layer:float","state":"minimized"}',
    ]);
    expect(report.row).toMatchObject({
      event: "parked",
      session: "sess-1",
      pr: PARK.pr,
      mux: "rex",
      target: "block:7",
      fork: null,
    });
    expect(readLedger(dataDir)).toEqual([report.row]);
  });

  test("a block already floating minimizes its own layer without floating again", async () => {
    const { deps, calls } = makeDeps(
      REX_LAYERS(
        windowWith(
          { id: "layer:tiled", kind: "tiled", blocks: ["block:8"] },
          { id: "layer:mine", kind: "floating", blocks: ["block:7"] },
        ),
      ),
      REX_ENV,
    );
    await parkSession(PARK, deps);
    const lines = argvs(calls).filter((line) => line.startsWith("rex api call"));
    expect(lines).toEqual([
      'rex api call -s main session.set_layer_state {"layer_id":"layer:mine","state":"minimized"}',
    ]);
  });

  test("the only visible pane in its tab is refused before anything moves", async () => {
    const { deps, calls, dataDir } = makeDeps(
      REX_LAYERS(
        windowWith(
          { id: "layer:tiled", kind: "tiled", blocks: ["block:7"] },
          { id: "layer:hidden", kind: "floating", state: "minimized", blocks: ["block:9"] },
        ),
      ),
      REX_ENV,
    );
    const error = await failureOf(parkSession(PARK, deps));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("close --handoff");
    expect(argvs(calls).some((line) => line.startsWith("rex api call"))).toBe(false);
    expect(readLedger(dataDir)).toEqual([]);
  });

  test("a failed minimize surfaces Rex's error and records nothing", async () => {
    const { deps, dataDir } = makeDeps(
      {
        ...REX_LAYERS(
          windowWith({ id: "layer:tiled", kind: "tiled", blocks: ["block:7", "block:8"] }),
        ),
        "rex api call -s main session.set_layer_state": fail("bad_request: last visible pane"),
      },
      REX_ENV,
    );
    expect((await failureOf(parkSession(PARK, deps))).message).toContain("last visible pane");
    expect(readLedger(dataDir)).toEqual([]);
  });

  test("herdr is refused with a pointer to close --handoff", async () => {
    const { deps, calls, dataDir } = makeDeps({}, HERDR_ENV);
    const error = await failureOf(parkSession(PARK, deps));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("close --handoff");
    expect(calls).toEqual([]);
    expect(readLedger(dataDir)).toEqual([]);
  });

  test("the command prints the report and the session keeps running", async () => {
    const { deps, out, calls } = makeDeps(
      REX_LAYERS(windowWith({ id: "layer:tiled", kind: "tiled", blocks: ["block:7", "block:8"] })),
      REX_ENV,
    );
    await createProgram(deps).parseAsync(
      ["park", "--session", PARK.session, "--pr", PARK.pr, "--summary", PARK.summary],
      { from: "user" },
    );
    expect(JSON.parse(out[0] ?? "")).toMatchObject({ row: { event: "parked" } });
    expect(argvs(calls).some((line) => line.startsWith("rex block close"))).toBe(false);
  });
});

describe("restoreSession", () => {
  test("sets the block's floating layer normal without focus", async () => {
    const { deps, calls } = makeDeps(
      REX_LAYERS(
        windowWith(
          { id: "layer:tiled", kind: "tiled", blocks: ["block:8"] },
          { id: "layer:mine", kind: "floating", state: "minimized", blocks: ["block:7"] },
        ),
      ),
      REX_ENV,
    );
    expect(await restoreSession(deps)).toEqual({ mux: "rex", target: "block:7" });
    expect(argvs(calls).at(-1)).toBe(
      'rex api call -s main session.set_layer_state {"layer_id":"layer:mine","state":"normal","focus":false}',
    );
  });

  test("a tiled block is not parked", async () => {
    const { deps } = makeDeps(
      REX_LAYERS(windowWith({ id: "layer:tiled", kind: "tiled", blocks: ["block:7"] })),
      REX_ENV,
    );
    expect((await failureOf(restoreSession(deps))).exitCode).toBe(2);
  });
});

describe("attachSession", () => {
  test("rex names only the session and never the stale block", async () => {
    const { deps, calls } = makeDeps(
      { "rex window new": ok(JSON.stringify({ block_ids: ["block:a"], window_id: "w" })) },
      REX_ENV,
    );
    expect(await attachSession(FORK, deps)).toEqual({ mux: "rex", pane: "block:a" });
    const line = argvs(calls).join("\n");
    expect(line).toBe(
      `rex window new -s main attach-${FORK} --focus=false --json -- claude attach ${FORK}`,
    );
    expect(line).not.toContain("block:7");
  });

  test("herdr creates an unfocused workspace and runs attach in its root pane", async () => {
    const { deps, calls } = makeDeps(
      {
        "herdr workspace create": ok(
          JSON.stringify({ result: { root_pane: { pane_id: "pane-new" } } }),
        ),
      },
      HERDR_ENV,
    );
    expect(await attachSession(FORK, deps)).toEqual({ mux: "herdr", pane: "pane-new" });
    expect(argvs(calls)).toEqual([
      `herdr workspace create --cwd /work/tree --label attach-${FORK} --no-focus`,
      `herdr pane run pane-new claude attach ${FORK}`,
    ]);
  });

  test("rejects an id that is not shell-safe", async () => {
    const { deps } = makeDeps({}, HERDR_ENV);
    expect((await failureOf(attachSession("x; rm -rf /", deps))).exitCode).toBe(2);
  });
});

describe("recordEnded", () => {
  test("appends an ended row with git facts", async () => {
    const { deps, dataDir } = makeDeps({}, REX_ENV);
    const row = await recordEnded({ session: FORK, pr: "u", outcome: "merged" }, deps);
    expect(row).toMatchObject({ event: "ended", fork: FORK, outcome: "merged", dirty: 2 });
    expect(readLedger(dataDir)).toEqual([row]);
  });
});

describe("report", () => {
  const rows = [
    closedRow({ branch: "a", path: "/a", dirty: 3, ts: "1" }),
    closedRow({ branch: "a", path: "/a", dirty: 0, ahead: 0, ts: "2" }),
    closedRow({ branch: "b", path: "/b", dirty: 0, ahead: 4, ts: "3" }),
    closedRow({ branch: "b", path: "/b", dirty: 1, ahead: 0, ts: "4" }),
    closedRow({ branch: "c", path: "/c", dirty: 0, ahead: 0, ts: "5" }),
    closedRow({ branch: "d", path: "/d", dirty: null, ahead: null, ts: "6" }),
  ];

  test("--left-behind keeps the latest row per branch that has work left", () => {
    expect(leftBehind(rows).map((row) => row.ts)).toEqual(["4"]);
  });

  test("closedRows without the filter returns every close row, skipping dispatch rows", () => {
    const { dataDir } = makeDeps({}, REX_ENV);
    appendDispatch(dispatchRow(), dataDir);
    for (const row of rows) appendDispatch(row, dataDir);
    expect(closedRows(dataDir, false)).toHaveLength(rows.length);
    expect(closedRows(dataDir, true).map((row) => row.ts)).toEqual(["4"]);
  });

  test("--left-behind skips a parked row, whose session is still running", () => {
    const parked = closedRow({ event: "parked", branch: "e", path: "/e", dirty: 2, ts: "7" });
    expect(leftBehind([...rows, parked]).map((row) => row.ts)).toEqual(["4"]);
  });

  test("--left-behind skips a relocated row, whose session moved on", () => {
    const moved = closedRow({ event: "relocated", branch: "f", path: "/f", dirty: 2, ts: "8" });
    expect(leftBehind([...rows, moved]).map((row) => row.ts)).toEqual(["4"]);
  });

  test("--count counts parked and relocated beside closed and ended", async () => {
    const { deps, out, dataDir } = makeDeps({}, REX_ENV);
    appendDispatch(dispatchRow(), dataDir);
    for (const row of rows) appendDispatch(row, dataDir);
    appendDispatch(closedRow({ event: "parked" }), dataDir);
    appendDispatch(closedRow({ event: "ended", outcome: "merged" }), dataDir);
    appendDispatch(closedRow({ event: "relocated", to: "other" }), dataDir);
    await createProgram(deps).parseAsync(["report", "--count"], { from: "user" });
    expect(out).toEqual([
      JSON.stringify({ closed: rows.length, parked: 1, ended: 1, relocated: 1 }),
    ]);
  });

  test("the command prints JSON rows", async () => {
    const { deps, out, dataDir } = makeDeps({}, REX_ENV);
    for (const row of rows) appendDispatch(row, dataDir);
    await createProgram(deps).parseAsync(["report", "--left-behind"], { from: "user" });
    expect(out).toEqual([JSON.stringify(rows.find((row) => row.ts === "4"))]);
  });
});

describe("readLedger", () => {
  test("skips malformed lines and reads old dispatch rows beside new ones", async () => {
    const { dataDir } = makeDeps({}, REX_ENV);
    const old = dispatchRow();
    const closed = closedRow();
    appendDispatch(old, dataDir);
    const file = Bun.file(ledgerPath(dataDir));
    await Bun.write(file, `${await file.text()}not json\n{"event":"closed"}\n{"ts":1}\n\n`);
    appendDispatch(closed, dataDir);
    expect(readLedger(dataDir)).toEqual([old, closed]);
  });

  test("a missing ledger is empty", () => {
    expect(readLedger(join(tmpdir(), "close-test-missing-dir"))).toEqual([]);
  });
});
