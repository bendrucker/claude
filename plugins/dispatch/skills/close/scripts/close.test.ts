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
  attachFork,
  closedRows,
  closePane,
  CloseError,
  createProgram,
  type Deps,
  leftBehind,
  recordEnded,
  resolveOwnPane,
} from "./close";

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string, code = 1): CommandResult => ({ code, stdout: "", stderr });

interface Call {
  argv: string[];
  options: RunOptions | undefined;
}

// Answers by the first argv words, so the order of git probes does not matter.
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
const BG_OK = ok(`backgrounded · ${FORK}\n  claude attach ${FORK}\n`);
const AGENTS_OK = ok(JSON.stringify([{ pid: 1, id: FORK, kind: "background", extra: true }]));

const REX_ENV = { REX_SESSION: "main", REX_BLOCK: "block:7" };
const HERDR_ENV = { HERDR_ENV: "1", HERDR_PANE_ID: "pane-9" };

function makeDeps(
  answers: Record<string, CommandResult>,
  env: Record<string, string | undefined>,
  sender: string | null = null,
): { deps: Deps; calls: Call[]; out: string[]; dataDir: string } {
  const { run, calls } = scripted({ ...GIT, ...answers });
  const out: string[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "close-test-"));
  const deps: Deps = {
    run,
    env,
    cwd: "/work/tree",
    dataDir,
    now: () => new Date("2026-11-03T12:00:00.000Z"),
    out: (line) => {
      out.push(line);
    },
    sender: () => Promise.resolve(sender == null ? null : { name: sender, mux: null }),
  };
  return { deps, calls, out, dataDir };
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

describe("resolveOwnPane", () => {
  test("rex uses the session and block", () => {
    expect(resolveOwnPane(REX_ENV)).toEqual({ mux: "rex", target: "block:7", rexSession: "main" });
  });

  test("herdr uses the pane id", () => {
    expect(resolveOwnPane(HERDR_ENV)).toEqual({ mux: "herdr", target: "pane-9", rexSession: null });
  });

  test("the herdr App is refused with exit 2", () => {
    try {
      resolveOwnPane({ HC_TERMINAL_ID: "t1" });
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(CloseError);
      expect(error).toMatchObject({ exitCode: 2 });
      expect(String(error)).toContain("herdr App");
    }
  });

  test("no multiplexer is refused", () => {
    expect(() => resolveOwnPane({})).toThrow(CloseError);
  });
});

describe("closePane", () => {
  test("rex closes its own block after writing the row and the report", async () => {
    const { deps, calls, out, dataDir } = makeDeps({}, REX_ENV);
    const report = await closePane({ summary: "done" }, deps);
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
    await closePane({}, deps);
    expect(seen).toEqual([{ rows: 1, out: 1 }]);
  });

  test("herdr closes the pane and never passes --group", async () => {
    const { deps, calls } = makeDeps({}, HERDR_ENV);
    await closePane({}, deps);
    expect(argvs(calls).at(-1)).toBe("herdr pane close pane-9");
    expect(argvs(calls).join(" ")).not.toContain("--group");
  });

  test("a herdr group conflict leaves the pane open and exits 1", async () => {
    const { deps } = makeDeps(
      { "herdr pane close": fail('{"error":{"code":"workspace_group_close_required"}}') },
      HERDR_ENV,
    );
    const error = await failureOf(closePane({}, deps));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain("linked worktree group");
  });

  test("confirmation_required is a group conflict too", async () => {
    const { deps } = makeDeps({ "herdr pane close": ok("confirmation_required") }, HERDR_ENV);
    expect((await failureOf(closePane({}, deps))).message).toContain("linked worktree group");
  });

  test("outside git the facts are null", async () => {
    const { deps } = makeDeps(
      { "git rev-parse --show-toplevel": fail("not a repo", 128) },
      REX_ENV,
    );
    const { row } = await closePane({}, deps);
    expect(row).toMatchObject({ branch: null, path: null, head: null, dirty: null, ahead: null });
  });

  test("no upstream leaves ahead null", async () => {
    const { deps } = makeDeps({ "git rev-list --count": fail("no upstream", 128) }, REX_ENV);
    expect((await closePane({}, deps)).row.ahead).toBeNull();
  });

  test("--handoff with --target is invalid", async () => {
    const { deps } = makeDeps({}, REX_ENV, "parent");
    const error = await failureOf(
      closePane({ handoff: true, target: "child", session: "s", pr: "u" }, deps),
    );
    expect(error.exitCode).toBe(2);
  });

  test("--handoff requires a session and a PR", async () => {
    const { deps } = makeDeps({}, REX_ENV);
    expect((await failureOf(closePane({ handoff: true }, deps))).exitCode).toBe(2);
  });
});

describe("closePane --handoff", () => {
  const options = { handoff: true, session: "sess-1", pr: "https://github.com/o/r/pull/1" };

  test("forks from the toplevel with a detached env, then records and closes", async () => {
    const { deps, calls, dataDir } = makeDeps(
      { "claude --bg": BG_OK, "claude agents": AGENTS_OK },
      { ...REX_ENV, CLAUDE_CODE_SSE_PORT: "1", CLAUDE_PID: "9" },
    );
    const report = await closePane(options, deps);
    const bg = calls.find((call) => call.argv[1] === "--bg");
    expect(bg?.argv.slice(0, 4)).toEqual(["claude", "--bg", "--resume", "sess-1"]);
    expect(bg?.argv[4]).toContain("background.md");
    expect(bg?.argv[4]).toContain(options.pr);
    expect(bg?.options?.cwd).toBe("/work/tree");
    expect(bg?.options?.env).toMatchObject({ CLAUDE_PID: undefined });
    expect(bg?.options?.env).not.toHaveProperty("REX_BLOCK");
    expect(argvs(calls).at(-1)).toBe("rex block close -s main block:7");
    expect(report.fork).toBe(FORK);
    expect(readLedger(dataDir)).toMatchObject([{ fork: FORK, pr: options.pr, session: "sess-1" }]);
  });

  test("a refused close stops the fork and records it ended", async () => {
    const { deps, calls, dataDir } = makeDeps(
      {
        "claude --bg": BG_OK,
        "claude agents": AGENTS_OK,
        "herdr pane close": fail("workspace_group_close_required"),
      },
      HERDR_ENV,
    );
    await failureOf(closePane(options, deps));
    expect(argvs(calls).at(-1)).toBe(`claude stop ${FORK}`);
    expect(readLedger(dataDir)).toMatchObject([
      { event: "closed", fork: FORK },
      { event: "ended", fork: FORK, outcome: "stopped" },
    ]);
  });

  test("aborts without a row or close when claude --bg prints no id", async () => {
    const { deps, calls, dataDir } = makeDeps(
      { "claude --bg": ok("started\nbut no id\n") },
      REX_ENV,
    );
    const error = await failureOf(closePane(options, deps));
    expect(error.exitCode).toBe(1);
    expect(readLedger(dataDir)).toEqual([]);
    expect(argvs(calls).some((line) => line.startsWith("rex block close"))).toBe(false);
  });

  test("aborts when claude --bg exits non-zero", async () => {
    const { deps, dataDir } = makeDeps({ "claude --bg": fail("daemon down") }, REX_ENV);
    await failureOf(closePane(options, deps));
    expect(readLedger(dataDir)).toEqual([]);
  });

  test("aborts when claude agents does not list the fork", async () => {
    const { deps, calls, dataDir } = makeDeps(
      {
        "claude --bg": BG_OK,
        "claude agents": ok(JSON.stringify([{ id: "other", kind: "background" }])),
      },
      REX_ENV,
    );
    const error = await failureOf(closePane(options, deps));
    expect(error.message).toContain(FORK);
    expect(readLedger(dataDir)).toEqual([]);
    expect(argvs(calls).some((line) => line.startsWith("rex block close"))).toBe(false);
  });

  test("aborts when the listed fork is not a background session", async () => {
    const { deps } = makeDeps(
      {
        "claude --bg": BG_OK,
        "claude agents": ok(JSON.stringify([{ id: FORK, kind: "interactive" }])),
      },
      REX_ENV,
    );
    await failureOf(closePane(options, deps));
  });

  test("aborts when claude agents prints something else", async () => {
    const { deps, dataDir } = makeDeps(
      { "claude --bg": BG_OK, "claude agents": ok("not json") },
      REX_ENV,
    );
    await failureOf(closePane(options, deps));
    expect(readLedger(dataDir)).toEqual([]);
  });
});

describe("closePane --target", () => {
  test("refuses a pane the caller did not dispatch", async () => {
    const { deps, dataDir, calls } = makeDeps({}, REX_ENV, "someone-else");
    appendDispatch(dispatchRow(), dataDir);
    const error = await failureOf(closePane({ target: "child" }, deps));
    expect(error.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  test("refuses an unknown name", async () => {
    const { deps } = makeDeps({}, REX_ENV, "parent");
    expect((await failureOf(closePane({ target: "ghost" }, deps))).exitCode).toBe(2);
  });

  test("refuses when the session has no registered name", async () => {
    const { deps, dataDir } = makeDeps({}, REX_ENV, null);
    appendDispatch(dispatchRow({ sender: null }), dataDir);
    await failureOf(closePane({ target: "child" }, deps));
  });

  test("refuses a dispatch that failed", async () => {
    const { deps, dataDir } = makeDeps({}, REX_ENV, "parent");
    appendDispatch(dispatchRow({ outcome: "failed" }), dataDir);
    await failureOf(closePane({ target: "child" }, deps));
  });

  test("closes the latest matching rex child with facts from its worktree", async () => {
    const { deps, dataDir, calls } = makeDeps({}, REX_ENV, "parent");
    appendDispatch(dispatchRow({ target: "block:old" }), dataDir);
    appendDispatch(dispatchRow({ target: "block:new" }), dataDir);
    const { row } = await closePane({ target: "child" }, deps);
    expect(argvs(calls).at(-1)).toBe("rex block close -s main block:new");
    expect(calls[0]?.options?.cwd).toBe("/work/child");
    expect(row.target).toBe("block:new");
  });

  test("closes a herdr child by its pane id", async () => {
    const { deps, dataDir, calls } = makeDeps({}, HERDR_ENV, "parent");
    appendDispatch(dispatchRow({ mux: "herdr", target: "pane-child" }), dataDir);
    await closePane({ target: "child" }, deps);
    expect(argvs(calls).at(-1)).toBe("herdr pane close pane-child");
  });
});

describe("attachFork", () => {
  test("rex names only the session and never the stale block", async () => {
    const { deps, calls } = makeDeps(
      { "rex window new": ok(JSON.stringify({ block_ids: ["block:a"], window_id: "w" })) },
      REX_ENV,
    );
    expect(await attachFork(FORK, deps)).toEqual({ mux: "rex", pane: "block:a" });
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
    expect(await attachFork(FORK, deps)).toEqual({ mux: "herdr", pane: "pane-new" });
    expect(argvs(calls)).toEqual([
      `herdr workspace create --cwd /work/tree --label attach-${FORK} --no-focus`,
      `herdr pane run pane-new claude attach ${FORK}`,
    ]);
  });

  test("rejects an id that is not shell-safe", async () => {
    const { deps } = makeDeps({}, HERDR_ENV);
    expect((await failureOf(attachFork("x; rm -rf /", deps))).exitCode).toBe(2);
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
    closedRow({ branch: "a", dirty: 3, ts: "1" }),
    closedRow({ branch: "a", dirty: 0, ahead: 0, ts: "2" }),
    closedRow({ branch: "b", dirty: 0, ahead: 4, ts: "3" }),
    closedRow({ branch: "b", dirty: 1, ahead: 0, ts: "4" }),
    closedRow({ branch: "c", dirty: 0, ahead: 0, ts: "5" }),
    closedRow({ branch: "d", dirty: null, ahead: null, ts: "6" }),
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

  test("the command prints JSON rows or a table", async () => {
    const { deps, out, dataDir } = makeDeps({}, REX_ENV);
    for (const row of rows) appendDispatch(row, dataDir);
    const program = createProgram(deps);
    await program.parseAsync(["report", "--left-behind", "--json"], { from: "user" });
    expect(out).toEqual([JSON.stringify(rows.find((row) => row.ts === "4"))]);
    out.length = 0;
    await program.parseAsync(["report", "--left-behind"], { from: "user" });
    expect(out[0]).toContain("branch");
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
