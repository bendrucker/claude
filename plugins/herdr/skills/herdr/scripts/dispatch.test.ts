import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type CommandResult,
  deriveName,
  dispatch,
  DispatchError,
  envelopeCode,
  fetchArgs,
  formatRecord,
  type Runner,
  spawnRunner,
  taskSummary,
} from "./dispatch";
import { appendDispatch, ledgerPath, resolveDataDir } from "./ledger";

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });

const envelope = (code: string, message = "nope") =>
  JSON.stringify({ error: { code, message }, id: "cli:test" });

const AGENT_LIST = ok(
  JSON.stringify({ result: { agents: [{ name: "reviewer" }, { name: null }] } }),
);
const WORKTREE = ok(
  JSON.stringify({
    result: {
      workspace: { workspace_id: "wZZ" },
      root_pane: { pane_id: "wZZ:p1" },
      worktree: { path: "/tmp/worktrees/demo/fix-thing" },
    },
  }),
);
const STARTED = ok(JSON.stringify({ result: { agent: { agent_status: "idle" } } }));
const BASE_OK = ok("abc123\n");
const AGENT_GET = ok(
  JSON.stringify({
    result: { agent: { agent_status: "working", agent_session: { value: "sess-1" } } },
  }),
);

function fakeRunner(responses: readonly CommandResult[]): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const run: Runner = (argv) => {
    calls.push([...argv]);
    const response = responses[index];
    if (response == null) throw new Error(`unscripted call ${index + 1}: ${argv.join(" ")}`);
    index += 1;
    return Promise.resolve(response);
  };
  return { run, calls };
}

async function failureOf(attempt: Promise<unknown>): Promise<DispatchError> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof DispatchError) return error;
    throw error;
  }
  throw new Error("expected the dispatch to fail");
}

const options = {
  repo: "/repo",
  branch: "fix-thing",
  prompt: "do the thing",
  base: "origin/main",
  timeout: 15_000,
};

const GIT_COMMON = ok("worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n");
// A remote list, then the URL of the remote the base names.
const REMOTES = [ok("origin\nupstream\n"), ok("git@github.com:owner/repo.git\n")];

const HAPPY_PATH = [
  AGENT_LIST,
  GIT_COMMON,
  ...REMOTES,
  ok(""),
  BASE_OK,
  WORKTREE,
  STARTED,
  ok(""),
  AGENT_GET,
];

describe("fetchArgs", () => {
  test.each([
    [
      "git@github.com:owner/repo.git",
      ["https://github.com/owner/repo.git", "+refs/heads/*:refs/remotes/origin/*"],
    ],
    [
      "git@github.com:owner/repo",
      ["https://github.com/owner/repo.git", "+refs/heads/*:refs/remotes/origin/*"],
    ],
    [
      "ssh://git@github.com/owner/repo.git\n",
      ["https://github.com/owner/repo.git", "+refs/heads/*:refs/remotes/origin/*"],
    ],
    ["https://github.com/owner/repo.git", ["origin"]],
    ["git@gitlab.com:owner/repo.git", ["origin"]],
  ])("fetches %j with %j", (url, expected) => {
    expect(fetchArgs("origin", url)).toEqual(expected);
  });
});

describe("deriveName", () => {
  test.each([
    ["fix-thing", new Set<string>(), "fix-thing"],
    ["Feature/Add Widget", new Set<string>(), "feature-add-widget"],
    ["fix_thing.v2", new Set<string>(), "fix_thing-v2"],
    ["--leading--dashes", new Set<string>(), "leading-dashes"],
    ["123", new Set<string>(), "agent"],
    ["fix-thing", new Set(["fix-thing"]), "fix-thing-2"],
    ["fix-thing", new Set(["fix-thing", "fix-thing-2"]), "fix-thing-3"],
    ["a".repeat(40), new Set<string>(), "a".repeat(32)],
    ["a".repeat(40), new Set(["a".repeat(32)]), `${"a".repeat(30)}-2`],
  ])("%s -> %s", (branch, taken, expected) => {
    const name = deriveName(branch, taken);
    expect(name).toBe(expected);
    expect(name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });
});

describe("taskSummary", () => {
  test.each([
    ["one line", "one line"],
    ["  padded  \nsecond", "padded"],
    ["\n\n\nafter blanks\nmore", "after blanks"],
    ["x".repeat(200), "x".repeat(120)],
    ["# Fix the parser\nbody", "Fix the parser"],
    ["---\n## Task\n", "Task"],
    ["- do the thing", "do the thing"],
    ["> quoted ask", "quoted ask"],
    ["", ""],
  ])("%p", (prompt, expected) => {
    expect(taskSummary(prompt)).toBe(expected);
  });
});

describe("envelopeCode", () => {
  test("reads a herdr error envelope", () => {
    expect(envelopeCode(envelope("agent_not_ready"))).toBe("agent_not_ready");
  });

  test("reads an envelope written behind other output", () => {
    expect(envelopeCode(`warming up\n${envelope("timeout")}\n`)).toBe("timeout");
  });

  test("returns null for anything that is not one", () => {
    expect(envelopeCode("git: command not found\n")).toBeNull();
    expect(envelopeCode(JSON.stringify({ result: { type: "agent_info" } }))).toBeNull();
  });
});

describe("validation", () => {
  test.each([
    ["branch", { ...options, branch: "fix; rm -rf /" }],
    ["branch", { ...options, branch: "fix $(whoami)" }],
    ["name", { ...options, name: "Reviewer" }],
    ["name", { ...options, name: "rm -rf" }],
    ["branch", { ...options, branch: "-x" }],
    ["prompt", { ...options, prompt: "x".repeat(200_000) }],
    ["base", { ...options, base: "-unstable" }],
    ["base", { ...options, base: "  " }],
  ])("rejects a hostile %s before spawning", async (_field, bad) => {
    const { run, calls } = fakeRunner([]);
    await failureOf(dispatch(bad, run));
    expect(calls).toEqual([]);
  });
});

describe("dispatch", () => {
  test("runs the sequence and never moves the checkout", async () => {
    const { run, calls } = fakeRunner(HAPPY_PATH);
    const { record, root } = await dispatch(options, run);

    expect(calls).toEqual([
      ["herdr", "agent", "list"],
      ["git", "-C", "/repo", "worktree", "list", "--porcelain"],
      ["git", "-C", "/repo", "remote"],
      ["git", "-C", "/repo", "remote", "get-url", "origin"],
      [
        "git",
        "-C",
        "/repo",
        "fetch",
        "https://github.com/owner/repo.git",
        "+refs/heads/*:refs/remotes/origin/*",
      ],
      ["git", "-C", "/repo", "rev-parse", "--verify", "--quiet", "origin/main"],
      [
        "herdr",
        "worktree",
        "create",
        "--cwd",
        "/repo",
        "--branch",
        "fix-thing",
        "--base",
        "origin/main",
        "--label",
        "fix-thing",
        "--no-focus",
      ],
      ["herdr", "agent", "start", "fix-thing", "--kind", "claude", "--pane", "wZZ:p1"],
      [
        "herdr",
        "agent",
        "prompt",
        "fix-thing",
        "do the thing",
        "--wait",
        "--until",
        "working",
        "--timeout",
        "15000",
      ],
      ["herdr", "agent", "get", "fix-thing"],
    ]);

    const mutating = new Set(["pull", "merge", "checkout", "reset", "rebase"]);
    for (const call of calls.filter((argv) => argv[0] === "git"))
      expect(call.some((arg) => mutating.has(arg))).toBe(false);

    expect(root).toBe("/repo");
    expect(formatRecord(record)).toMatchInlineSnapshot(
      `"{"workspace":"wZZ","pane":"wZZ:p1","agent":"fix-thing","path":"/tmp/worktrees/demo/fix-thing","branch":"fix-thing","session":"sess-1","status":"working","prompted":true}"`,
    );
  });

  test("fetches nothing when the base names no remote", async () => {
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      BASE_OK,
      WORKTREE,
      STARTED,
      ok(""),
      AGENT_GET,
    ]);
    await dispatch({ ...options, base: "release-2026" }, run);
    expect(calls.map((argv) => argv.slice(0, 4))).not.toContainEqual([
      "git",
      "-C",
      "/repo",
      "fetch",
    ]);
  });

  test("fetches the remote the base names", async () => {
    const { run, calls } = fakeRunner(HAPPY_PATH);
    await dispatch({ ...options, base: "upstream/main" }, run);
    expect(calls).toContainEqual([
      "git",
      "-C",
      "/repo",
      "fetch",
      "https://github.com/owner/repo.git",
      "+refs/heads/*:refs/remotes/upstream/*",
    ]);
  });

  test("uses an explicit name that no live agent holds", async () => {
    const { run, calls } = fakeRunner(HAPPY_PATH);
    const { record } = await dispatch({ ...options, name: "custom" }, run);
    expect(calls.at(-1)).toEqual(["herdr", "agent", "get", "custom"]);
    expect(record.agent).toBe("custom");
  });

  test("rejects an explicit name a live agent holds, before creating anything", async () => {
    const { run, calls } = fakeRunner([AGENT_LIST]);
    const failure = await failureOf(dispatch({ ...options, name: "reviewer" }, run));
    expect(failure.message).toMatch(/already bound to a live agent/);
    expect(failure.partial).toBeNull();
    expect(calls).toEqual([["herdr", "agent", "list"]]);
  });

  test("forwards a herdr envelope untouched with no partial record", async () => {
    const stderr = envelope(
      "linked_worktree_source",
      "New and open worktree actions start from the repo parent workspace.",
    );
    const { run } = fakeRunner([AGENT_LIST, GIT_COMMON, ...REMOTES, ok(""), BASE_OK, fail(stderr)]);

    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toBe(stderr);
    expect(failure.partial).toBeNull();
  });

  test("emits the partial record when the failure lands after the worktree exists", async () => {
    const stderr = envelope("agent_pane_busy");
    const { run } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(stderr),
    ]);

    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toBe(stderr);
    expect(failure.partial).toEqual({
      workspace: "wZZ",
      pane: "wZZ:p1",
      agent: null,
      path: "/tmp/worktrees/demo/fix-thing",
      branch: "fix-thing",
      session: null,
      status: "unknown",
      prompted: false,
    });
  });

  test("treats agent_not_ready as placed and skips the prompt", async () => {
    const blocked = ok(
      JSON.stringify({ result: { agent: { agent_status: "blocked", agent_session: null } } }),
    );
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(envelope("agent_not_ready")),
      blocked,
    ]);

    const { record } = await dispatch(options, run);
    expect(calls.map((argv) => argv.slice(0, 3))).not.toContainEqual(["herdr", "agent", "prompt"]);
    expect(record.agent).toBe("fix-thing");
    expect(record.status).toBe("blocked");
    expect(record.session).toBeNull();
    expect(record.prompted).toBe(false);
  });

  test.each(["timeout", "agent_prompt_stalled"])(
    "reports status after a %s on the wait",
    async (code) => {
      const idle = ok(
        JSON.stringify({
          result: { agent: { agent_status: "idle", agent_session: { value: "sess-2" } } },
        }),
      );
      const { run } = fakeRunner([
        AGENT_LIST,
        GIT_COMMON,
        ...REMOTES,
        ok(""),
        BASE_OK,
        WORKTREE,
        STARTED,
        fail(envelope(code)),
        idle,
      ]);

      const { record } = await dispatch(options, run);
      expect(record.status).toBe("idle");
      expect(record.session).toBe("sess-2");
      // Neither code confirms the agent took the work, so the caller is told
      // to read the pane rather than that the prompt landed.
      expect(record.prompted).toBe(false);
    },
  );

  test("fails the dispatch when the repository cannot list its remotes", async () => {
    const { run } = fakeRunner([AGENT_LIST, GIT_COMMON, fail("fatal: not a git repository\n")]);
    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toMatch(/not a git repository/);
    expect(failure.partial).toBeNull();
  });

  test("names the step when it fails without writing to stderr", async () => {
    const { run } = fakeRunner([AGENT_LIST, { code: 128, stdout: "", stderr: "  \n" }]);
    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toBe("git -C /repo worktree list --porcelain exited 128");
  });

  test("takes the next free name when the wanted one binds before the start", async () => {
    const relisted = ok(
      JSON.stringify({ result: { agents: [{ name: "reviewer" }, { name: "fix-thing" }] } }),
    );
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(envelope("agent_name_taken")),
      relisted,
      STARTED,
      ok(""),
      AGENT_GET,
    ]);

    const { record } = await dispatch(options, run);
    expect(record.agent).toBe("fix-thing-2");
    expect(calls.at(-1)).toEqual(["herdr", "agent", "get", "fix-thing-2"]);
  });

  test("keeps retrying when the replacement name races too", async () => {
    const took = (...names: string[]) =>
      ok(JSON.stringify({ result: { agents: names.map((name) => ({ name })) } }));
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(envelope("agent_name_taken")),
      took("fix-thing"),
      fail(envelope("agent_name_taken")),
      took("fix-thing", "fix-thing-2"),
      STARTED,
      ok(""),
      ok(JSON.stringify({ result: { agent: { agent_status: "working" } } })),
    ]);

    const { record } = await dispatch(options, run);
    expect(record.agent).toBe("fix-thing-3");
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(3);
  });

  test("gives up on the name after a bounded number of races", async () => {
    const took = ok(JSON.stringify({ result: { agents: [{ name: "fix-thing" }] } }));
    const taken = envelope("agent_name_taken");
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(taken),
      took,
      fail(taken),
      took,
      fail(taken),
    ]);

    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toBe(taken);
    expect(failure.partial?.path).toBe("/tmp/worktrees/demo/fix-thing");
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(3);
  });

  test("waits for idle before prompting an agent that came up working", async () => {
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      ok(JSON.stringify({ result: { agent: { agent_status: "working" } } })),
      ok(""),
      ok(""),
      AGENT_GET,
    ]);

    const { record } = await dispatch(options, run);
    expect(calls).toContainEqual([
      "herdr",
      "agent",
      "wait",
      "fix-thing",
      "--until",
      "idle",
      "--timeout",
      "15000",
    ]);
    expect(record.prompted).toBe(true);
  });

  test("leaves the prompt unsent when a startup turn never settles", async () => {
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      ok(JSON.stringify({ result: { agent: { agent_status: "working" } } })),
      fail(envelope("timeout")),
      AGENT_GET,
    ]);

    const { record } = await dispatch(options, run);
    expect(record.prompted).toBe(false);
    expect(calls.filter((argv) => argv[2] === "prompt")).toHaveLength(0);
  });

  test("forwards an unrelated start failure rather than renaming", async () => {
    const stderr = envelope("agent_pane_busy");
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(stderr),
    ]);

    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toBe(stderr);
    expect(failure.partial?.path).toBe("/tmp/worktrees/demo/fix-thing");
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(1);
    expect(calls.filter((argv) => argv[2] === "list")).toHaveLength(1);
  });

  test("never substitutes a name the caller asked for", async () => {
    const stderr = envelope("agent_name_taken");
    const { run, calls } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      BASE_OK,
      WORKTREE,
      fail(stderr),
    ]);

    const failure = await failureOf(dispatch({ ...options, name: "custom" }, run));
    expect(failure.message).toBe(stderr);
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(1);
    expect(calls.filter((argv) => argv[2] === "list")).toHaveLength(1);
  });

  test("rejects a herdr payload that does not match the expected shape", async () => {
    const { run } = fakeRunner([
      AGENT_LIST,
      GIT_COMMON,
      ...REMOTES,
      ok(""),
      ok(JSON.stringify({ result: {} })),
      AGENT_LIST,
    ]);
    const failure = await failureOf(dispatch(options, run));
    expect(failure.message).toMatch(/herdr worktree create returned an unexpected shape/);
  });
});

const LedgerRow = z.object({
  ts: z.string(),
  task: z.string(),
  repo: z.string(),
  branch: z.string(),
  path: z.string(),
  workspace: z.string(),
  pane: z.string(),
  agent: z.string().nullable(),
  session: z.string().nullable(),
  outcome: z.enum(["dispatched", "orphaned"]),
});

describe("cli", () => {
  const script = join(import.meta.dir, "dispatch.ts");
  const filled = join(mkdtempSync(join(tmpdir(), "dispatch-cli-")), "prompt.txt");

  beforeAll(async () => {
    await Bun.write(filled, "do the thing\n");
  });

  test.each([
    ["no branch", ["--prompt", filled], 2, /--branch is required/],
    ["a bad branch", ["--branch", "bad branch", "--prompt", filled], 1, /must match/],
    ["a missing prompt file", ["--branch", "ok", "--prompt", "/nope/gone.txt"], 2, /cannot read/],
    ["an empty prompt", ["--branch", "ok", "--prompt", "/dev/null"], 2, /prompt is empty/],
    [
      "a non-numeric timeout",
      ["--branch", "ok", "--prompt", filled, "--timeout", "abc"],
      2,
      /--timeout must be a positive/,
    ],
  ])("rejects %s", async (_label, args, status, expected) => {
    const proc = Bun.spawn(["bun", script, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(status);
    expect(stderr).toMatch(expected);
  });
});

describe("spawnRunner", () => {
  test("reports a missing binary as a result rather than throwing", async () => {
    const result = await spawnRunner(["herdr-does-not-exist-9f3a"]);
    expect(result.code).toBe(127);
    expect(result.stderr).toMatch(/herdr-does-not-exist-9f3a/);
  });
});

describe("ledger", () => {
  test("appends a row under the data-dir override", async () => {
    const dataDir = resolveDataDir(mkdtempSync(join(tmpdir(), "dispatch-ledger-")));
    const row = {
      ts: "2026-09-17T00:00:00.000Z",
      task: "do the thing",
      repo: "/repo",
      branch: "fix-thing",
      path: "/tmp/worktrees/demo/fix-thing",
      workspace: "wZZ",
      pane: "wZZ:p1",
      agent: "fix-thing",
      session: "sess-1",
      outcome: "dispatched" as const,
    };

    appendDispatch(row, dataDir);
    appendDispatch({ ...row, branch: "other" }, dataDir);

    const rows = (await Bun.file(ledgerPath(dataDir)).text())
      .trimEnd()
      .split("\n")
      .map((line) => LedgerRow.parse(JSON.parse(line)));
    expect(rows).toEqual([row, { ...row, branch: "other" }]);
  });
});
