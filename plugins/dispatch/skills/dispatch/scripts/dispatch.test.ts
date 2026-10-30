import { mkdtempSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  backgroundId,
  classifyScreen,
  type CommandResult,
  decodeArg,
  deriveName,
  detachedEnv,
  detectMux,
  dispatch,
  DispatchError,
  type DispatchOptions,
  encodeArg,
  envelopeCode,
  execSession,
  fetchArgs,
  formatRecord,
  mergeSettings,
  type Mux,
  type Pause,
  readProgramStatus,
  remoteCommand,
  type ReportedStatus,
  type RunOptions,
  type Runner,
  type Settings,
  settingsKeys,
  settingsPatch,
  spawnRunner,
  type Start,
  type Status,
  taskSummary,
} from "./dispatch";
import { appendDispatch, ledgerPath, resolveDataDir } from "./ledger";

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string, code = 1): CommandResult => ({ code, stdout: "", stderr });

const envelope = (code: string, message = "nope") =>
  JSON.stringify({ error: { code, message }, id: "cli:test" });

const PATH = "/tmp/worktrees/demo/fix-thing";

const worktreeList = (path: string) =>
  ok(
    JSON.stringify({
      schema: 2,
      items: [
        { branch: "main", worktree: { path: "/repo", main: true } },
        { branch: null, worktree: { path: "/repo/.worktrees/detached" } },
        { branch: "other", worktree: null },
        { branch: "fix-thing", worktree: { path } },
      ],
    }),
  );

const AGENT_LIST = ok(
  JSON.stringify({ result: { agents: [{ name: "reviewer" }, { name: null }] } }),
);
const GIT_COMMON = ok("worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n");
// A remote list, then the URL of the remote the base names.
const REMOTES = [ok("origin\nupstream\n"), ok("git@github.com:owner/repo.git\n")];
const BASE_OK = ok("abc123\n");
const SWITCHED = ok("");
const PREPARE = [GIT_COMMON, ...REMOTES, ok(""), BASE_OK];

const REX_CREATED = ok(JSON.stringify({ block_ids: ["block:new"], window_id: "window:new" }));
const reported = (state: string, extra: Record<string, string> = {}) =>
  ok(
    JSON.stringify({
      records: [
        { state, app: "claude-code", effective_app: "claude-code", ...extra, owner: { pid: 1 } },
      ],
    }),
  );
const REPORTED_WORKING = reported("working");
const NO_REPORT = ok(JSON.stringify({ records: [] }));
const screen = (...lines: string[]) => ok(`${["╭─ Claude Code", ...lines].join("\n")}\n`);
const WORKING_SCREEN = screen("✻ Thinking… (3s · esc to interrupt)", "❯ ");
const IDLE_SCREEN = screen("❯ ", "  ⏵⏵ auto mode on");
const TRUST_SCREEN = screen("Do you trust the files in this folder?", "❯ 1. Yes, proceed");
// What the probe dispatch showed after a two-second first turn.
const FINISHED_SCREEN = screen(
  "❯ Reply to any SendMessage with 'probe ok' and do nothing else.",
  "",
  "⏺ Ready.",
  "",
  "✻ Cogitated for 2s · done 8:00 PM",
  "",
  "────────────────",
  "❯ ",
  "────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
);
// A fresh session whose input box shows a placeholder and no reply.
const FRESH_SCREEN = screen(
  "│ Welcome to Claude Code │",
  "",
  "────────────────",
  '❯ Try "fix lint errors"',
  "────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
);

const WORKSPACE = ok(
  JSON.stringify({
    result: {
      workspace: { workspace_id: "wZZ" },
      tab: { tab_id: "wZZ:t1" },
      root_pane: { pane_id: "wZZ:p1" },
    },
  }),
);
const STARTED = ok(JSON.stringify({ result: { agent: { agent_status: "idle" } } }));
const agentIn = (status: string, session: string | null = "sess-1") =>
  ok(
    JSON.stringify({
      result: {
        agent: {
          agent_status: status,
          agent_session: session == null ? null : { value: session },
        },
      },
    }),
  );
const BUSY = fail(envelope("agent_pane_busy"));

function fakeRunner(responses: readonly CommandResult[]): {
  run: Runner;
  calls: string[][];
  options: (RunOptions | undefined)[];
} {
  const calls: string[][] = [];
  const options: (RunOptions | undefined)[] = [];
  let index = 0;
  const run: Runner = (argv, runOptions) => {
    calls.push([...argv]);
    options.push(runOptions);
    const response = responses[index];
    if (response == null) throw new Error(`unscripted call ${index + 1}: ${argv.join(" ")}`);
    index += 1;
    return Promise.resolve(response);
  };
  return { run, calls, options };
}

const instant: Pause = () => Promise.resolve();

function recordedPause(): { pause: Pause; pauses: number[] } {
  const pauses: number[] = [];
  const pause: Pause = (ms) => {
    pauses.push(ms);
    return Promise.resolve();
  };
  return { pause, pauses };
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

function makeOptions(overrides: Partial<DispatchOptions> = {}): DispatchOptions {
  return {
    repo: "/repo",
    branch: "fix-thing",
    prompt: "do the thing",
    base: "origin/main",
    timeout: 3_000,
    mux: "rex",
    rexSession: "session:s1",
    rexBlock: "block:here",
    ...overrides,
  };
}

const herdrOptions = (overrides: Partial<DispatchOptions> = {}) =>
  makeOptions({ mux: "herdr", rexSession: undefined, rexBlock: undefined, ...overrides });

const rexPath = (path = PATH) => [...PREPARE, SWITCHED, worktreeList(path)];
const herdrPath = (path = PATH) => [AGENT_LIST, ...rexPath(path)];

const WT_SWITCH = [
  "wt",
  "-C",
  "/repo",
  "switch",
  "--create",
  "fix-thing",
  "--base",
  "origin/main",
  "--no-cd",
  "--yes",
];

// What git prints when a sibling worktree holds .git/config.lock.
const LOCK_MESSAGE = "error: could not lock config file .git/config: File exists";
const CONFIG_LOCKED = fail(`${LOCK_MESSAGE}\n`, 255);

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

describe("detectMux", () => {
  test.each<{ name: string; env: Record<string, string>; expected: Mux | RegExp }>([
    { name: "a Rex block", env: { REX_BLOCK: "block:1" }, expected: "rex" },
    { name: "a herdr pane", env: { HERDR_ENV: "1" }, expected: "herdr" },
    { name: "an empty REX_BLOCK", env: { REX_BLOCK: "", HERDR_ENV: "1" }, expected: "herdr" },
    {
      name: "both, nested",
      env: { REX_BLOCK: "block:1", HERDR_ENV: "1", TERM_PROGRAM: "rex" },
      expected: /both Rex and herdr.*pass --mux rex or --mux herdr/,
    },
    {
      name: "HERDR_ENV other than 1",
      env: { HERDR_ENV: "0" },
      expected: /--mux rex, --mux herdr, or --mux bg/,
    },
    { name: "neither", env: {}, expected: /no multiplexer hosts this session/ },
  ])("$name", ({ env, expected }) => {
    if (typeof expected === "string") expect(detectMux(env)).toBe(expected);
    else expect(() => detectMux(env)).toThrow(expected);
  });
});

describe("backgroundId", () => {
  test.each<{ name: string; stdout: string; expected: string | null }>([
    { name: "a bare id", stdout: "a1b2c3\n", expected: "a1b2c3" },
    {
      name: "an id inside an attach hint",
      stdout: "Started fix-thing in the background.\nAttach with: claude attach a1b2c3\n",
      expected: "a1b2c3",
    },
    { name: "prose with no hint", stdout: "Started in the background\n", expected: null },
    { name: "nothing", stdout: "", expected: null },
  ])("$name -> $expected", ({ stdout, expected }) => {
    expect(backgroundId(stdout)).toBe(expected);
  });
});

describe("detachedEnv", () => {
  test("unsets the launching session's variables and keeps the rest", () => {
    expect(
      detachedEnv({
        CLAUDECODE: "1",
        CLAUDE_CODE_SESSION_ID: "s",
        CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/sock",
        CLAUDE_PLUGIN_DATA: "/data",
        CLAUDE_CODE_OAUTH_TOKEN: "t",
        CLAUDECODE_EXTRA: "x",
        PATH: "/bin",
      }),
    ).toEqual({
      CLAUDECODE: undefined,
      CLAUDE_CODE_SESSION_ID: undefined,
      CLAUDE_CODE_MESSAGING_SOCKET: undefined,
      CLAUDE_PLUGIN_DATA: undefined,
    });
  });
});

describe("classifyScreen", () => {
  test.each<{ name: string; screen: string; expected: Status }>([
    { name: "a spinner", screen: WORKING_SCREEN.stdout, expected: "working" },
    { name: "the trust dialog", screen: TRUST_SCREEN.stdout, expected: "blocked" },
    {
      name: "a permission prompt",
      screen: screen("Bash command", "Do you want to proceed?", "❯ 1. Yes").stdout,
      expected: "blocked",
    },
    { name: "an idle prompt", screen: IDLE_SCREEN.stdout, expected: "unknown" },
    {
      name: "a spinner without the interrupt hint",
      screen: screen("✽ Newspapering… (32s · ↓ 1.2k tokens · still thinking)", "❯ ").stdout,
      expected: "working",
    },
    {
      name: "a minute-long spinner",
      screen: screen("✶ Pondering… (1m 4s · ↑ 300 tokens)", "❯ ").stdout,
      expected: "working",
    },
    {
      name: "a tool line that only ends in an ellipsis",
      screen: screen("⏺ Reading… (src/main.ts)", "❯ ").stdout,
      expected: "unknown",
    },
    {
      name: "a failed --exec held open",
      screen: "dispatch failed: base names no commit\n",
      expected: "failed",
    },
    { name: "a finished first turn", screen: FINISHED_SCREEN.stdout, expected: "working" },
    {
      name: "a reply with no timing line",
      screen: screen("❯ do the thing", "⏺ Done.", "❯ ").stdout,
      expected: "working",
    },
    {
      name: "a timing line alone",
      screen: screen("✻ Worked for 12s · done 9:14 AM", "❯ ").stdout,
      expected: "working",
    },
    {
      name: "a fresh session with a placeholder",
      screen: FRESH_SCREEN.stdout,
      expected: "unknown",
    },
    {
      name: "a reply before any prompt",
      screen: screen("⏺ SessionStart hook ran", "❯ ").stdout,
      expected: "unknown",
    },
    {
      name: "a spinner scrolled off the bottom",
      screen: ["esc to interrupt", ...Array.from({ length: 30 }, () => "output"), "❯ "].join("\n"),
      expected: "unknown",
    },
    { name: "an empty screen", screen: "", expected: "unknown" },
  ])("$name -> $expected", ({ screen: text, expected }) => {
    expect(classifyScreen(text)).toBe(expected);
  });
});

describe("readProgramStatus", () => {
  const claudeRecord = (entry: Record<string, string>) => ({
    app: "claude-code",
    effective_app: "claude-code",
    ...entry,
  });
  const records = (...entries: Record<string, string>[]) =>
    JSON.stringify({ records: entries.map(claudeRecord) });

  test.each<{ name: string; stdout: string; expected: ReportedStatus | null }>([
    { name: "working", stdout: records({ state: "working" }), expected: { status: "working" } },
    { name: "done", stdout: records({ state: "done" }), expected: { status: "working" } },
    { name: "error", stdout: records({ state: "error" }), expected: { status: "failed" } },
    { name: "idle", stdout: records({ state: "idle" }), expected: { status: "unknown" } },
    { name: "clear", stdout: records({ state: "clear" }), expected: { status: "unknown" } },
    {
      name: "blocked with its kind and message",
      stdout: records({ state: "blocked", kind: "question", msg: "Which branch?" }),
      expected: { status: "blocked", kind: "question", message: "Which branch?" },
    },
    {
      name: "blocked alone",
      stdout: records({ state: "blocked" }),
      expected: { status: "blocked" },
    },
    {
      name: "the session's record over a task's",
      stdout: records({ id: "t1", state: "blocked" }, { state: "working" }),
      expected: { status: "working" },
    },
    {
      name: "a task's record when the session has none",
      stdout: records({ id: "t1", state: "working" }),
      expected: { status: "working" },
    },
    {
      name: "only another program's record",
      stdout: JSON.stringify({ records: [{ state: "working", effective_app: "vim" }] }),
      expected: null,
    },
    { name: "no records", stdout: JSON.stringify({ records: [] }), expected: null },
    { name: "something that is not JSON", stdout: "unknown method", expected: null },
  ])("reads $name", ({ stdout, expected }) => {
    expect(readProgramStatus(stdout)).toEqual(expected);
  });
});

describe("mergeSettings", () => {
  test.each<{ name: string; base: Settings; patch: Settings; expected: Settings }>([
    {
      name: "keeps existing keys",
      base: { model: "opus", permissions: { deny: ["Bash(rm:*)"] } },
      patch: { permissions: { allow: ["Bash(bun test:*)"] } },
      expected: {
        model: "opus",
        permissions: { deny: ["Bash(rm:*)"], allow: ["Bash(bun test:*)"] },
      },
    },
    {
      name: "appends array entries without duplicates",
      base: { permissions: { allow: ["Read", "Bash(ls:*)"] } },
      patch: { permissions: { allow: ["Bash(ls:*)", "Edit", "Edit"] } },
      expected: { permissions: { allow: ["Read", "Bash(ls:*)", "Edit"] } },
    },
    {
      name: "merges nested objects",
      base: { sandbox: { enabled: true, filesystem: { allowWrite: ["~/a"] } } },
      patch: { sandbox: { filesystem: { allowWrite: ["~/a", "~/b"] } } },
      expected: { sandbox: { enabled: true, filesystem: { allowWrite: ["~/a", "~/b"] } } },
    },
    {
      name: "lets the patch set a scalar",
      base: { model: "opus" },
      patch: { model: "sonnet" },
      expected: { model: "sonnet" },
    },
  ])("$name", ({ base, patch, expected }) => {
    expect(mergeSettings(base, patch)).toEqual(expected);
  });

  test("names the leaf keys a patch writes", () => {
    expect(
      settingsKeys(
        mergeSettings({ env: { FOO: "1" } }, settingsPatch(["Read"], ["~/.cache/dispatch-probe"])),
      ),
    ).toEqual(["env.FOO", "permissions.allow", "sandbox.filesystem.allowWrite"]);
    expect(settingsKeys(settingsPatch([], []))).toEqual([]);
  });
});

describe("validation", () => {
  test.each<{ name: string; bad: DispatchOptions }>([
    { name: "a branch with a semicolon", bad: makeOptions({ branch: "fix; rm -rf /" }) },
    { name: "a branch with a substitution", bad: makeOptions({ branch: "fix $(whoami)" }) },
    { name: "a branch that is a flag", bad: makeOptions({ branch: "-x" }) },
    { name: "an uppercase name", bad: makeOptions({ name: "Reviewer" }) },
    { name: "a name with a space", bad: makeOptions({ name: "rm -rf" }) },
    { name: "an oversized prompt", bad: makeOptions({ prompt: "x".repeat(200_000) }) },
    { name: "a base that is a flag", bad: makeOptions({ base: "-unstable" }) },
    { name: "a blank base", bad: makeOptions({ base: "  " }) },
    { name: "a split under herdr", bad: herdrOptions({ split: true }) },
    { name: "a split without REX_BLOCK", bad: makeOptions({ split: true, rexBlock: "" }) },
    { name: "a Rex tab without a session", bad: makeOptions({ rexSession: undefined }) },
    { name: "a split under bg", bad: makeOptions({ mux: "bg", split: true }) },
    { name: "a host under herdr", bad: herdrOptions({ host: "studio", rexSession: "work" }) },
    { name: "a host with a split", bad: makeOptions({ host: "studio", split: true }) },
    { name: "a host without a session", bad: makeOptions({ host: "studio", rexSession: "" }) },
    {
      name: "a prompt that fits locally but not encoded for a host",
      bad: makeOptions({ host: "studio", prompt: "x".repeat(100_000) }),
    },
    {
      name: "settings too large to send to a host",
      bad: makeOptions({ host: "studio", settings: { env: { BIG: "x".repeat(100_000) } } }),
    },
  ])("rejects $name before spawning", async ({ bad }) => {
    const { run, calls } = fakeRunner([]);
    await failureOf(dispatch(bad, run, instant));
    expect(calls).toEqual([]);
  });
});

describe("dispatch under rex", () => {
  test("creates the worktree with wt and opens a tab running claude", async () => {
    const { run, calls } = fakeRunner([...rexPath(), REX_CREATED, REPORTED_WORKING]);
    const { record, root } = await dispatch(makeOptions(), run, instant);

    expect(calls).toEqual([
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
      WT_SWITCH,
      ["wt", "-C", "/repo", "list", "--format=json"],
      [
        "rex",
        "window",
        "new",
        "-s",
        "session:s1",
        "fix-thing",
        "-c",
        PATH,
        "--focus=false",
        "--json",
        "--",
        "claude",
        "--name",
        "fix-thing",
        "--",
        "do the thing",
      ],
      ["rex", "block", "call", "-b", "block:new", "program_status", "{}"],
    ]);

    const mutating = new Set(["pull", "merge", "checkout", "reset", "rebase"]);
    for (const call of calls.filter((argv) => argv[0] === "git"))
      expect(call.some((arg) => mutating.has(arg))).toBe(false);

    expect(root).toBe("/repo");
    expect(formatRecord(record)).toMatchInlineSnapshot(
      `"{"mux":"rex","target":"block:new","host":null,"name":"fix-thing","path":"/tmp/worktrees/demo/fix-thing","branch":"fix-thing","session":null,"status":"working","settings":[]}"`,
    );
  });

  test("splits the current block when asked", async () => {
    const { run, calls } = fakeRunner([...rexPath(), REX_CREATED, REPORTED_WORKING]);
    await dispatch(makeOptions({ split: true, name: "custom" }), run, instant);
    expect(calls.find((argv) => argv[0] === "rex")).toEqual([
      "rex",
      "split",
      "-b",
      "block:here",
      "--split=right",
      "-c",
      PATH,
      "--label",
      "fix-thing",
      "--focus=false",
      "--json",
      "--",
      "claude",
      "--name",
      "custom",
      "--",
      "do the thing",
    ]);
  });

  const unreported = (shown: CommandResult) => [NO_REPORT, shown];
  test.each<{ name: string; polls: CommandResult[][]; status: Status }>([
    {
      name: "reports working after idle",
      polls: [[reported("idle")], [REPORTED_WORKING]],
      status: "working",
    },
    { name: "reports its first turn done", polls: [[reported("done")]], status: "working" },
    { name: "reports an error", polls: [[reported("error")]], status: "failed" },
    {
      name: "reports idle until the timeout",
      polls: [[reported("idle")], [reported("clear")], [reported("idle")]],
      status: "unknown",
    },
    {
      name: "shows the trust dialog before reporting",
      polls: [unreported(IDLE_SCREEN), unreported(TRUST_SCREEN)],
      status: "blocked",
    },
    {
      name: "shows a spinner but reports nothing until the timeout",
      polls: [unreported(WORKING_SCREEN), unreported(WORKING_SCREEN), unreported(WORKING_SCREEN)],
      status: "working",
    },
    {
      name: "reports nothing and stays fresh",
      polls: [unreported(FRESH_SCREEN), unreported(FRESH_SCREEN), unreported(FRESH_SCREEN)],
      status: "unknown",
    },
    {
      name: "runs under a Rex without program status",
      polls: [
        [fail("unknown method"), FINISHED_SCREEN],
        [fail("unknown method"), FINISHED_SCREEN],
        [fail("unknown method"), FINISHED_SCREEN],
      ],
      status: "working",
    },
  ])("polls until the session $name", async ({ polls, status }) => {
    const { pause, pauses } = recordedPause();
    const { run } = fakeRunner([...rexPath(), REX_CREATED, ...polls.flat()]);
    const { record } = await dispatch(makeOptions(), run, pause);
    expect(record.status).toBe(status);
    expect(pauses).toEqual(Array.from({ length: polls.length - 1 }, () => 1_000));
  });

  test("records what a blocked session reports", async () => {
    const blocked = reported("blocked", { kind: "permission", msg: "Allow Bash(rm -rf tmp)?" });
    const { run } = fakeRunner([...rexPath(), REX_CREATED, blocked]);
    const { record } = await dispatch(makeOptions(), run, instant);
    expect(record).toMatchObject({
      status: "blocked",
      blockedKind: "permission",
      blockedMessage: "Allow Bash(rm -rf tmp)?",
    });
  });

  test("fails with the worktree recorded when rex refuses the tab", async () => {
    const { run } = fakeRunner([...rexPath(), fail("rex: no such session\n")]);
    const failure = await failureOf(dispatch(makeOptions(), run, instant));
    expect(failure.message).toBe("rex: no such session\n");
    expect(failure.partial).toMatchObject({ path: PATH, target: null, mux: "rex" });
    expect(failure.root).toBe("/repo");
  });

  test("rejects a rex payload with no block", async () => {
    const { run } = fakeRunner([...rexPath(), ok(JSON.stringify({ block_ids: [] }))]);
    const failure = await failureOf(dispatch(makeOptions(), run, instant));
    expect(failure.message).toMatch(/rex window new returned an unexpected shape/);
  });
});

describe("dispatch under bg", () => {
  const bgOptions = (overrides: Partial<DispatchOptions> = {}) =>
    makeOptions({ mux: "bg", rexSession: undefined, rexBlock: undefined, ...overrides });

  test("runs claude --bg in the worktree with this session's variables unset", async () => {
    const { run, calls, options } = fakeRunner([
      ...rexPath(),
      ok("a1b2c3\n"),
      IDLE_SCREEN,
      WORKING_SCREEN,
    ]);
    const { record } = await dispatch(bgOptions(), run, instant);

    expect(calls.slice(-3)).toEqual([
      ["claude", "--bg", "--name", "fix-thing", "--", "do the thing"],
      ["claude", "logs", "a1b2c3"],
      ["claude", "logs", "a1b2c3"],
    ]);
    expect(options.at(-3)).toEqual({ cwd: PATH, env: detachedEnv(process.env) });
    expect(formatRecord(record)).toMatchInlineSnapshot(
      `"{"mux":"bg","target":"a1b2c3","host":null,"name":"fix-thing","path":"/tmp/worktrees/demo/fix-thing","branch":"fix-thing","session":null,"status":"working","settings":[]}"`,
    );
  });

  test.each<{ name: string; logs: CommandResult; status: Status }>([
    { name: "a finished first turn", logs: FINISHED_SCREEN, status: "working" },
    { name: "a fresh session", logs: FRESH_SCREEN, status: "unknown" },
  ])("reads $name from claude logs as $status", async ({ logs, status }) => {
    const { run } = fakeRunner([...rexPath(), ok("a1b2c3\n"), logs, logs, logs]);
    const { record } = await dispatch(bgOptions(), run, instant);
    expect(record.status).toBe(status);
  });

  test("reads logs by name when the id cannot be parsed", async () => {
    const { run, calls } = fakeRunner([
      ...rexPath(),
      ok("Started.\nMore prose.\n"),
      WORKING_SCREEN,
    ]);
    const { record } = await dispatch(bgOptions(), run, instant);
    expect(record.target).toBeNull();
    expect(calls.at(-1)).toEqual(["claude", "logs", "fix-thing"]);
  });

  test("fails with the worktree recorded when claude --bg fails", async () => {
    const { run } = fakeRunner([...rexPath(), fail("claude: not logged in\n")]);
    const failure = await failureOf(dispatch(bgOptions(), run, instant));
    expect(failure.message).toBe("claude: not logged in\n");
    expect(failure.partial).toMatchObject({ mux: "bg", path: PATH, target: null });
  });
});

describe("dispatch under rex from outside", () => {
  test("opens the tab in the session passed in", async () => {
    const { run, calls } = fakeRunner([...rexPath(), REX_CREATED, REPORTED_WORKING]);
    await dispatch(makeOptions({ rexSession: "Claude", rexBlock: undefined }), run, instant);
    expect(calls.find((argv) => argv[0] === "rex")?.slice(0, 6)).toEqual([
      "rex",
      "window",
      "new",
      "-s",
      "Claude",
      "fix-thing",
    ]);
  });
});

describe("dispatch under herdr", () => {
  test("creates a workspace on the worktree and starts claude with the prompt", async () => {
    const { run, calls } = fakeRunner([...herdrPath(), WORKSPACE, STARTED, agentIn("working")]);
    const { record } = await dispatch(herdrOptions(), run, instant);

    expect(calls[0]).toEqual(["herdr", "agent", "list"]);
    expect(calls.slice(-3)).toEqual([
      ["herdr", "workspace", "create", "--cwd", PATH, "--label", "fix-thing", "--no-focus"],
      [
        "herdr",
        "agent",
        "start",
        "fix-thing",
        "--kind",
        "claude",
        "--pane",
        "wZZ:p1",
        "--",
        "--name",
        "fix-thing",
        "--",
        "do the thing",
      ],
      ["herdr", "agent", "get", "fix-thing"],
    ]);
    expect(formatRecord(record)).toMatchInlineSnapshot(
      `"{"mux":"herdr","target":"wZZ:p1","host":null,"name":"fix-thing","path":"/tmp/worktrees/demo/fix-thing","branch":"fix-thing","session":"sess-1","status":"working","settings":[]}"`,
    );
  });

  test.each<{ name: string; polls: CommandResult[]; status: Status }>([
    { name: "a finished turn", polls: [agentIn("done")], status: "working" },
    { name: "a dialog", polls: [agentIn("blocked", null)], status: "blocked" },
    { name: "idle then working", polls: [agentIn("idle"), agentIn("working")], status: "working" },
    {
      name: "unknown throughout",
      polls: [agentIn("unknown"), agentIn("idle"), fail(envelope("agent_not_found"))],
      status: "unknown",
    },
  ])("reports $name as $status", async ({ polls, status }) => {
    const { run, calls } = fakeRunner([...herdrPath(), WORKSPACE, STARTED, ...polls]);
    const { record } = await dispatch(herdrOptions(), run, instant);
    expect(record.status).toBe(status);
    expect(calls.filter((argv) => argv[2] === "get")).toHaveLength(polls.length);
  });

  test("treats agent_not_ready as placed and reports the dialog", async () => {
    const { run } = fakeRunner([
      ...herdrPath(),
      WORKSPACE,
      fail(envelope("agent_not_ready")),
      agentIn("blocked", null),
    ]);
    const { record } = await dispatch(herdrOptions(), run, instant);
    expect(record).toMatchObject({ name: "fix-thing", status: "blocked", session: null });
  });

  test("rejects an explicit name a live agent holds, before creating anything", async () => {
    const { run, calls } = fakeRunner([AGENT_LIST]);
    const failure = await failureOf(dispatch(herdrOptions({ name: "reviewer" }), run, instant));
    expect(failure.message).toMatch(/already bound to a live agent/);
    expect(failure.partial).toBeNull();
    expect(calls).toEqual([["herdr", "agent", "list"]]);
  });

  test("takes the next free name, in herdr and claude both, when the wanted one races", async () => {
    const took = (...names: string[]) =>
      ok(JSON.stringify({ result: { agents: names.map((name) => ({ name })) } }));
    const { run, calls } = fakeRunner([
      ...herdrPath(),
      WORKSPACE,
      fail(envelope("agent_name_taken")),
      took("fix-thing"),
      fail(envelope("agent_name_taken")),
      took("fix-thing", "fix-thing-2"),
      STARTED,
      agentIn("working"),
    ]);
    const { record } = await dispatch(herdrOptions(), run, instant);
    expect(record.name).toBe("fix-thing-3");
    const starts = calls.filter((argv) => argv[2] === "start");
    expect(starts.map((argv) => [argv[3], argv[10]])).toEqual([
      ["fix-thing", "fix-thing"],
      ["fix-thing-2", "fix-thing-2"],
      ["fix-thing-3", "fix-thing-3"],
    ]);
  });

  test("gives up on the name after a bounded number of races", async () => {
    const took = ok(JSON.stringify({ result: { agents: [{ name: "fix-thing" }] } }));
    const taken = envelope("agent_name_taken");
    const { run, calls } = fakeRunner([
      ...herdrPath(),
      WORKSPACE,
      fail(taken),
      took,
      fail(taken),
      took,
      fail(taken),
    ]);
    const failure = await failureOf(dispatch(herdrOptions(), run, instant));
    expect(failure.message).toBe(taken);
    expect(failure.partial).toMatchObject({ path: PATH, target: "wZZ:p1" });
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(3);
  });

  test("never substitutes a name the caller asked for", async () => {
    const stderr = envelope("agent_name_taken");
    const { run, calls } = fakeRunner([...herdrPath(), WORKSPACE, fail(stderr)]);
    const failure = await failureOf(dispatch(herdrOptions({ name: "custom" }), run, instant));
    expect(failure.message).toBe(stderr);
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(1);
  });

  test.each<{ name: string; afterBusy: CommandResult[]; started: boolean }>([
    { name: "frees up", afterBusy: [STARTED, agentIn("working")], started: true },
    { name: "stays busy", afterBusy: [BUSY, BUSY], started: false },
  ])("retries start while the pane $name", async ({ afterBusy, started }) => {
    const { run, calls } = fakeRunner([...herdrPath(), WORKSPACE, BUSY, ...afterBusy]);
    const attempt = dispatch(herdrOptions(), run, instant);
    if (started) expect((await attempt).record.status).toBe("working");
    else expect((await failureOf(attempt)).partial?.path).toBe(PATH);
    expect(calls.filter((argv) => argv[2] === "start")).toHaveLength(started ? 2 : 3);
  });
});

describe("dispatch worktree", () => {
  test("fetches nothing when the base names no remote", async () => {
    const { run, calls } = fakeRunner([
      GIT_COMMON,
      ok("origin\n"),
      BASE_OK,
      SWITCHED,
      worktreeList(PATH),
      REX_CREATED,
      REPORTED_WORKING,
    ]);
    await dispatch(makeOptions({ base: "release-2026" }), run, instant);
    expect(calls.filter((argv) => argv[3] === "fetch")).toEqual([]);
  });

  test("falls back to the remote when the HTTPS fetch fails", async () => {
    const { run, calls } = fakeRunner([
      GIT_COMMON,
      ...REMOTES,
      fail("fatal: could not read Username"),
      ok(""),
      BASE_OK,
      SWITCHED,
      worktreeList(PATH),
      REX_CREATED,
      REPORTED_WORKING,
    ]);
    await dispatch(makeOptions(), run, instant);
    expect(calls.filter((argv) => argv[3] === "fetch").map((argv) => argv[4])).toEqual([
      "https://github.com/owner/repo.git",
      "origin",
    ]);
  });

  test("fetches the remote the base names", async () => {
    const { run, calls } = fakeRunner([...rexPath(), REX_CREATED, REPORTED_WORKING]);
    await dispatch(makeOptions({ base: "upstream/main" }), run, instant);
    expect(calls).toContainEqual([
      "git",
      "-C",
      "/repo",
      "fetch",
      "https://github.com/owner/repo.git",
      "+refs/heads/*:refs/remotes/upstream/*",
    ]);
  });

  test("refuses a base that names no commit before creating anything", async () => {
    const { run, calls } = fakeRunner([...PREPARE.slice(0, -1), fail("", 1)]);
    const failure = await failureOf(dispatch(makeOptions(), run, instant));
    expect(failure.message).toMatch(/names no commit in \/repo/);
    expect(calls.filter((argv) => argv[0] === "wt")).toEqual([]);
  });

  test("retries a wt switch that lost the config lock", async () => {
    const { pause, pauses } = recordedPause();
    const { run, calls } = fakeRunner([
      ...PREPARE,
      CONFIG_LOCKED,
      CONFIG_LOCKED,
      SWITCHED,
      worktreeList(PATH),
      REX_CREATED,
      REPORTED_WORKING,
    ]);
    const { record } = await dispatch(makeOptions(), run, pause);
    expect(calls.filter((argv) => argv[3] === "switch")).toHaveLength(3);
    expect(pauses).toEqual([250, 250]);
    expect(record.path).toBe(PATH);
  });

  test("forwards the lock failure once it outlasts the timeout", async () => {
    const { run } = fakeRunner([...PREPARE, CONFIG_LOCKED, CONFIG_LOCKED, CONFIG_LOCKED]);
    const failure = await failureOf(
      dispatch(makeOptions({ timeout: 500 }), run, recordedPause().pause),
    );
    expect(failure.message).toBe(CONFIG_LOCKED.stderr);
    expect(failure.partial).toBeNull();
  });

  test("fails when wt list shows no worktree for the branch", async () => {
    const { run } = fakeRunner([...PREPARE, SWITCHED, ok(JSON.stringify({ items: [] }))]);
    const failure = await failureOf(dispatch(makeOptions(), run, instant));
    expect(failure.message).toBe("wt list shows no worktree for fix-thing");
  });

  test.each([
    { name: "initializes", result: ok(""), expected: undefined },
    {
      name: "records a failure and still starts the session",
      result: fail("fatal: clone of 'vendor/lib' failed\n"),
      expected: "fatal: clone of 'vendor/lib' failed",
    },
  ])("submodules: $name", async ({ result, expected }) => {
    const path = mkdtempSync(join(tmpdir(), "dispatch-submodules-"));
    await Bun.write(join(path, ".gitmodules"), "");
    const { run, calls } = fakeRunner([...rexPath(path), result, REX_CREATED, REPORTED_WORKING]);
    const { record } = await dispatch(makeOptions(), run, instant);
    expect(calls).toContainEqual([
      "git",
      "-C",
      path,
      "submodule",
      "update",
      "--init",
      "--recursive",
    ]);
    expect(record.submoduleError).toBe(expected);
    expect(record.status).toBe("working");
  });

  test("fails the dispatch when the repository cannot list its remotes", async () => {
    const { run } = fakeRunner([GIT_COMMON, fail("fatal: not a git repository\n")]);
    const failure = await failureOf(dispatch(makeOptions(), run, instant));
    expect(failure.message).toMatch(/not a git repository/);
    expect(failure.partial).toBeNull();
  });

  test("names the step when it fails without writing to stderr", async () => {
    const { run } = fakeRunner([{ code: 128, stdout: "", stderr: "  \n" }]);
    const failure = await failureOf(dispatch(makeOptions(), run, instant));
    expect(failure.message).toBe("git -C /repo worktree list --porcelain exited 128");
  });
});

describe("dispatch settings", () => {
  const settingsFile = (path: string) => join(path, ".claude", "settings.local.json");
  const CHECK_IGNORE = (path: string) => [
    "git",
    "-C",
    path,
    "check-ignore",
    "--quiet",
    ".claude/settings.local.json",
  ];
  const patch = mergeSettings(
    { env: { PROBE: "1" } },
    settingsPatch(["Bash(bun test:*)"], ["~/.cache/dispatch-probe"]),
  );

  test("writes a new file and reports the keys", async () => {
    const path = mkdtempSync(join(tmpdir(), "dispatch-settings-"));
    const { run, calls } = fakeRunner([...rexPath(path), ok(""), REX_CREATED, REPORTED_WORKING]);
    const { record } = await dispatch(makeOptions({ settings: patch }), run, instant);

    expect(calls).toContainEqual(CHECK_IGNORE(path));
    expect(record.settings).toEqual([
      "env.PROBE",
      "permissions.allow",
      "sandbox.filesystem.allowWrite",
    ]);
    expect(JSON.parse(await Bun.file(settingsFile(path)).text())).toEqual(patch);
  });

  test("merges into an existing file", async () => {
    const path = mkdtempSync(join(tmpdir(), "dispatch-settings-"));
    await Bun.write(
      settingsFile(path),
      JSON.stringify({
        enabledPlugins: { "x@y": true },
        permissions: { allow: ["Bash(bun test:*)", "Read"] },
      }),
    );
    const { run } = fakeRunner([...rexPath(path), ok(""), REX_CREATED, REPORTED_WORKING]);
    await dispatch(makeOptions({ settings: patch }), run, instant);

    expect(JSON.parse(await Bun.file(settingsFile(path)).text())).toEqual({
      enabledPlugins: { "x@y": true },
      permissions: { allow: ["Bash(bun test:*)", "Read"] },
      env: { PROBE: "1" },
      sandbox: { filesystem: { allowWrite: ["~/.cache/dispatch-probe"] } },
    });
  });

  test.each<{ name: string; ignored: CommandResult; message: RegExp }>([
    { name: "is tracked", ignored: fail("", 1), message: /is not git-ignored in/ },
    { name: "cannot be checked", ignored: fail("fatal: bad\n", 128), message: /fatal: bad/ },
  ])("refuses to write when the file $name", async ({ ignored, message }) => {
    const path = mkdtempSync(join(tmpdir(), "dispatch-settings-"));
    const { run, calls } = fakeRunner([...rexPath(path), ignored]);
    const failure = await failureOf(dispatch(makeOptions({ settings: patch }), run, instant));

    expect(failure.message).toMatch(message);
    expect(failure.partial?.path).toBe(path);
    expect(await Bun.file(settingsFile(path)).exists()).toBe(false);
    expect(calls.filter((argv) => argv[0] === "rex")).toEqual([]);
  });

  test("refuses to overwrite a file that is not JSON", async () => {
    const path = mkdtempSync(join(tmpdir(), "dispatch-settings-"));
    await Bun.write(settingsFile(path), "{ nope");
    const { run } = fakeRunner([...rexPath(path), ok("")]);
    const failure = await failureOf(dispatch(makeOptions({ settings: patch }), run, instant));
    expect(failure.message).toMatch(/is not JSON/);
    expect(await Bun.file(settingsFile(path)).text()).toBe("{ nope");
  });

  test("skips the check when there is nothing to write", async () => {
    const { run, calls } = fakeRunner([...rexPath(), REX_CREATED, REPORTED_WORKING]);
    await dispatch(makeOptions({ settings: settingsPatch([], []) }), run, instant);
    expect(calls.filter((argv) => argv[3] === "check-ignore")).toEqual([]);
  });
});

describe("argument encoding", () => {
  test("round-trips any text", () => {
    hegel.test((tc) => {
      const text = tc.draw(gs.text());
      expect(decodeArg(encodeArg(text), "arg")).toBe(text);
    });
  });

  test.each<{ name: string; text: string }>([
    { name: "a frontmatter prompt", text: "---\ntitle: x\n---\n-leading dash" },
    { name: "shell syntax", text: "'q' \"dq\" $HOME `tick` $(whoami); rm -rf /" },
    { name: "settings JSON", text: JSON.stringify({ permissions: { allow: ["Bash(bun:*)"] } }) },
  ])("encodes $name as one word of base64", ({ text }) => {
    const encoded = encodeArg(text);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decodeArg(encoded, "arg")).toBe(text);
  });

  test("rejects text that is not base64", () => {
    expect(() => decodeArg("not base64!", "--prompt-base64")).toThrow(
      "--prompt-base64 is not base64",
    );
  });
});

describe("dispatch to another host", () => {
  const SETTINGS: Settings = { permissions: { allow: ["Bash(bun test:*)"] } };
  const REMOTE_PATH = "/home/ben/src/demo/.worktrees/fix-thing";
  const remoteOptions = (overrides: Partial<DispatchOptions> = {}) =>
    makeOptions({
      host: "studio",
      rexSession: "work",
      rexBlock: undefined,
      repo: "/home/ben/src/demo",
      settings: SETTINGS,
      ...overrides,
    });
  const capture = ["rex", "-S", "studio", "capture", "-b", "block:new", "--trim"];
  const status = [
    "rex",
    "-S",
    "studio",
    "block",
    "call",
    "-b",
    "block:new",
    "program_status",
    "{}",
  ];

  test("opens a kept-open tab on the host running the launcher with --exec", async () => {
    const shown = ok(`dispatch worktree: ${REMOTE_PATH}\n${WORKING_SCREEN.stdout}`);
    const { run, calls } = fakeRunner([REX_CREATED, REPORTED_WORKING, shown]);
    const { record, root } = await dispatch(remoteOptions(), run, instant);

    const [launch] = calls;
    expect(launch?.slice(0, 16)).toEqual([
      "rex",
      "-S",
      "studio",
      "window",
      "new",
      "-s",
      "work",
      "fix-thing",
      "-c",
      "/home/ben/src/demo",
      "--keep-open",
      "--focus=false",
      "--json",
      "--",
      "sh",
      "-c",
    ]);
    expect(launch?.[16]).toContain(
      '"$HOME/.claude-repo/plugins/dispatch/skills/dispatch/scripts/dispatch.ts"',
    );
    expect(launch?.slice(17)).toEqual([
      "dispatch",
      "--exec",
      "--repo",
      "/home/ben/src/demo",
      "--branch",
      "fix-thing",
      "--base",
      "origin/main",
      "--name",
      "fix-thing",
      "--timeout",
      "3000",
      "--prompt-base64",
      encodeArg("do the thing"),
      "--settings-base64",
      encodeArg(JSON.stringify(SETTINGS)),
    ]);
    expect(calls.slice(1)).toEqual([status, capture]);
    expect(root).toBe("/home/ben/src/demo");
    expect(formatRecord(record)).toMatchInlineSnapshot(
      `"{"mux":"rex","target":"block:new","host":"studio","name":"fix-thing","path":"/home/ben/src/demo/.worktrees/fix-thing","branch":"fix-thing","session":null,"status":"working","settings":["permissions.allow"]}"`,
    );
  });

  const NO_ROUTE = fail("no route");
  test.each<{ name: string; responses: CommandResult[]; expected: Status; calls: string[][] }>([
    {
      name: "failed once the launcher prints its marker",
      responses: [NO_REPORT, ok("dispatch failed: base names no commit\n"), NO_ROUTE],
      expected: "failed",
      calls: [status, capture, capture],
    },
    {
      name: "working once claude reports after the worktree is made",
      responses: [NO_REPORT, ok("Cloning…\n"), REPORTED_WORKING, NO_ROUTE],
      expected: "working",
      calls: [status, capture, status, capture],
    },
    {
      name: "unknown when the host stops answering",
      responses: Array.from({ length: 7 }, () => NO_ROUTE),
      expected: "unknown",
      calls: [status, capture, status, capture, status, capture, capture],
    },
  ])("reports $name", async ({ responses, expected, calls: wanted }) => {
    const { run, calls } = fakeRunner([REX_CREATED, ...responses]);
    const { record } = await dispatch(remoteOptions(), run, instant);
    expect(record.status).toBe(expected);
    expect(record.path).toBeNull();
    expect(calls.slice(1)).toEqual(wanted);
  });

  test("omits the settings word when there are none", async () => {
    const { run, calls } = fakeRunner([REX_CREATED, REPORTED_WORKING, NO_ROUTE]);
    await dispatch(remoteOptions({ settings: {} }), run, instant);
    expect(calls[0]).not.toContain("--settings-base64");
  });

  test("leaves no record when the host refuses the tab", async () => {
    const { run } = fakeRunner([fail("connect: host studio is unreachable")]);
    const failure = await failureOf(dispatch(remoteOptions(), run, instant));
    expect(failure.message).toMatch(/unreachable/);
    expect(failure.partial).toBeNull();
  });
});

describe("remote launcher", () => {
  const launch = async (env: Record<string, string>) => {
    const argv = remoteCommand(makeOptions({ prompt: "it's $HOME" }), "fix-thing");
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { stdout, code };
  };
  const bunDir = join(process.execPath, "..");

  test("expands $HOME on the host and hands every word to the script", async () => {
    const home = mkdtempSync(join(tmpdir(), "dispatch-home-"));
    await Bun.write(
      join(home, ".claude-repo/plugins/dispatch/skills/dispatch/scripts/dispatch.ts"),
      "console.log(JSON.stringify(process.argv.slice(2)));\n",
    );
    const { stdout, code } = await launch({ HOME: home, PATH: `${bunDir}:/usr/bin:/bin` });
    expect(code).toBe(0);
    const words = z.array(z.string()).parse(JSON.parse(stdout));
    expect(words.slice(0, 2)).toEqual(["--exec", "--repo"]);
    expect(decodeArg(words[words.indexOf("--prompt-base64") + 1] ?? "", "prompt")).toBe(
      "it's $HOME",
    );
  });

  test.each<{ name: string; path: string; expected: RegExp }>([
    {
      name: "the script is not deployed",
      path: "",
      expected: /dispatch failed: .* is not deployed/,
    },
    {
      name: "bun is not on PATH",
      path: "/usr/bin:/bin",
      expected: /dispatch failed: bun is not on PATH/,
    },
  ])("prints the failure marker when $name", async ({ path, expected }) => {
    const home = mkdtempSync(join(tmpdir(), "dispatch-home-"));
    const { stdout, code } = await launch({
      HOME: home,
      PATH: path === "" ? `${bunDir}:/usr/bin:/bin` : path,
    });
    expect(code).toBe(1);
    expect(stdout).toMatch(expected);
    expect(classifyScreen(stdout)).toBe("failed");
  });
});

describe("exec on the host", () => {
  const recordedStart = (): { start: Start; starts: { argv: string[]; cwd: string }[] } => {
    const starts: { argv: string[]; cwd: string }[] = [];
    const start: Start = (argv, cwd) => {
      starts.push({ argv: [...argv], cwd });
      return Promise.resolve(0);
    };
    return { start, starts };
  };
  const execOptions = {
    repo: "/repo",
    branch: "fix-thing",
    base: "origin/main",
    timeout: 3_000,
    name: "fix-thing",
    prompt: "-do the thing",
  };

  test("prepares the worktree and settings, then runs claude under Remote Control", async () => {
    const path = mkdtempSync(join(tmpdir(), "dispatch-exec-"));
    const settings = { permissions: { allow: ["Read"] } };
    const { run, calls } = fakeRunner([...rexPath(path), ok("")]);
    const { start, starts } = recordedStart();
    const code = await execSession({ ...execOptions, settings }, run, instant, start);

    expect(code).toBe(0);
    expect(calls).toContainEqual(WT_SWITCH);
    expect(calls.filter((argv) => argv[0] === "rex" || argv[0] === "herdr")).toEqual([]);
    expect(JSON.parse(await Bun.file(join(path, ".claude", "settings.local.json")).text())).toEqual(
      settings,
    );
    expect(starts).toEqual([
      {
        argv: [
          "claude",
          "--name",
          "fix-thing",
          "--remote-control",
          "fix-thing",
          "--",
          "-do the thing",
        ],
        cwd: path,
      },
    ]);
  });

  test("starts nothing when the worktree cannot be made", async () => {
    const { run } = fakeRunner([...PREPARE.slice(0, -1), fail("", 1)]);
    const { start, starts } = recordedStart();
    const failure = await failureOf(execSession(execOptions, run, instant, start));
    expect(failure.message).toMatch(/names no commit/);
    expect(starts).toEqual([]);
  });
});

const LedgerRow = z.object({
  ts: z.string(),
  task: z.string(),
  repo: z.string(),
  branch: z.string(),
  path: z.string(),
  mux: z.enum(["rex", "herdr"]),
  target: z.string().nullable(),
  host: z.string().nullable(),
  name: z.string(),
  session: z.string().nullable(),
  outcome: z.enum(["dispatched", "orphaned"]),
});

describe("cli", () => {
  const script = join(import.meta.dir, "dispatch.ts");
  const dir = mkdtempSync(join(tmpdir(), "dispatch-cli-"));
  const filled = join(dir, "prompt.txt");
  const badJson = join(dir, "bad.json");
  const rex = { REX_BLOCK: "block:1", REX_SESSION: "session:1" };

  beforeAll(async () => {
    await Bun.write(filled, "do the thing\n");
    await Bun.write(badJson, "[1]");
  });

  test.each<{
    name: string;
    args: string[];
    env: Record<string, string>;
    status: number;
    expected: RegExp;
  }>([
    {
      name: "no branch",
      args: ["--prompt", filled],
      env: rex,
      status: 2,
      expected: /--branch is required/,
    },
    {
      name: "a bad branch",
      args: ["--branch", "bad branch", "--prompt", filled],
      env: rex,
      status: 1,
      expected: /must match/,
    },
    {
      name: "a missing prompt file",
      args: ["--branch", "ok", "--prompt", "/nope/gone.txt"],
      env: rex,
      status: 2,
      expected: /cannot read/,
    },
    {
      name: "an empty prompt",
      args: ["--branch", "ok", "--prompt", "/dev/null"],
      env: rex,
      status: 2,
      expected: /prompt is empty/,
    },
    {
      name: "a non-numeric timeout",
      args: ["--branch", "ok", "--prompt", filled, "--timeout", "abc"],
      env: rex,
      status: 2,
      expected: /--timeout must be a positive/,
    },
    {
      name: "no multiplexer",
      args: ["--branch", "ok", "--prompt", filled],
      env: {},
      status: 2,
      expected: /pass --mux rex, --mux herdr, or --mux bg/,
    },
    {
      name: "nested multiplexers",
      args: ["--branch", "ok", "--prompt", filled],
      env: { ...rex, HERDR_ENV: "1" },
      status: 2,
      expected: /both Rex and herdr/,
    },
    {
      name: "a Rex tab from outside Rex without --session",
      args: ["--branch", "ok", "--prompt", filled, "--mux", "rex"],
      env: {},
      status: 1,
      expected: /pass --session <id or label>/,
    },
    {
      name: "an unknown multiplexer",
      args: ["--branch", "ok", "--prompt", filled, "--mux", "tmux"],
      env: rex,
      status: 2,
      expected: /--mux must be one of rex, herdr/,
    },
    {
      name: "settings JSON that is not an object",
      args: ["--branch", "ok", "--prompt", filled, "--settings-json", badJson],
      env: rex,
      status: 2,
      expected: /must hold a JSON object/,
    },
    {
      name: "a host with only this machine's REX_SESSION",
      args: ["--branch", "ok", "--prompt", filled, "--host", "studio"],
      env: rex,
      status: 1,
      expected: /--host needs --session naming a session on studio/,
    },
    {
      name: "a host under herdr",
      args: ["--branch", "ok", "--prompt", filled, "--host", "studio", "--session", "work"],
      env: { HERDR_ENV: "1" },
      status: 1,
      expected: /--host needs --mux rex/,
    },
  ])("rejects $name", async ({ args, env, status, expected }) => {
    const {
      REX_BLOCK: _block,
      REX_SESSION: _session,
      HERDR_ENV: _herdr,
      ...inherited
    } = process.env;
    const proc = Bun.spawn(["bun", script, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...inherited, ...env },
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).toBe(status);
    expect(stderr).toMatch(expected);
  });

  test.each<{ name: string; args: string[]; expected: RegExp }>([
    { name: "no branch", args: ["--name", "n"], expected: /--branch is required/ },
    { name: "no name", args: ["--branch", "ok"], expected: /--name is required/ },
    {
      name: "a prompt that is not base64",
      args: ["--branch", "ok", "--name", "n", "--prompt-base64", "!!"],
      expected: /--prompt-base64 is not base64/,
    },
    {
      name: "a bad branch",
      args: ["--branch", "bad branch", "--name", "n", "--prompt-base64", encodeArg("x")],
      expected: /must match/,
    },
  ])("marks an --exec failure on screen for $name", async ({ args, expected }) => {
    const proc = Bun.spawn(["bun", script, "--exec", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(1);
    expect(stdout).toMatch(expected);
    expect(classifyScreen(stdout)).toBe("failed");
  });
});

describe("spawnRunner", () => {
  test("reports a missing binary as a result rather than throwing", async () => {
    const result = await spawnRunner(["dispatch-does-not-exist-9f3a"]);
    expect(result.code).toBe(127);
    expect(result.stderr).toMatch(/dispatch-does-not-exist-9f3a/);
  });

  test("runs in the given directory and unsets variables mapped to undefined", async () => {
    const dir = await realpath(mkdtempSync(join(tmpdir(), "dispatch-cwd-")));
    process.env.DISPATCH_DROP = "inherited";
    try {
      const result = await spawnRunner(
        ["sh", "-c", "pwd; printenv DISPATCH_KEEP; printenv DISPATCH_DROP || echo unset"],
        { cwd: dir, env: { DISPATCH_KEEP: "kept", DISPATCH_DROP: undefined } },
      );
      expect(result.stdout).toBe(`${dir}\nkept\nunset\n`);
    } finally {
      delete process.env.DISPATCH_DROP;
    }
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
      path: PATH,
      mux: "rex" as const,
      target: "block:new",
      host: null,
      name: "fix-thing",
      session: null,
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

  test("defaults to the dispatch plugin's data dir", () => {
    const saved = process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.CLAUDE_PLUGIN_DATA;
    try {
      expect(resolveDataDir()).toEndWith(join("plugins", "data", "dispatch-bendrucker"));
    } finally {
      if (saved != null) process.env.CLAUDE_PLUGIN_DATA = saved;
    }
  });
});
