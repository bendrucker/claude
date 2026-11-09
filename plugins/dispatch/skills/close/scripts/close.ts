#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the dispatch ledger under ~/.claude/plugins and reaches the claude daemon and multiplexer sockets
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { z } from "zod";
import {
  backgroundId,
  detachedEnv,
  detectMux,
  type Mux,
  type Runner,
  readSender,
  type Sender,
  spawnRunner,
} from "../../dispatch/scripts/dispatch";
import {
  appendDispatch,
  type ClosedRow,
  isClosedRow,
  readLedger,
  resolveDataDir,
} from "../../dispatch/scripts/ledger";

type Env = Readonly<Record<string, string | undefined>>;
type PaneMux = "rex" | "herdr";

export class CloseError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CloseError";
  }
}

export interface Deps {
  run: Runner;
  env: Env;
  cwd: string;
  dataDir: string;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
  out: (line: string) => void;
  sender: () => Promise<Sender | null>;
  spawnDetached: (argv: readonly string[], cwd: string, logPath: string) => Promise<number>;
  alive: (pid: number) => boolean;
  kill: (pid: number) => void;
}

// Claude Code kills its Bash tool's process tree on exit, so sh backgrounds the helper and exits, leaving it to launchd.
async function spawnDetached(
  argv: readonly string[],
  cwd: string,
  logPath: string,
): Promise<number> {
  const launcher = Bun.spawn(
    ["sh", "-c", '"$@" >>"$0" 2>&1 </dev/null & echo $!', logPath, ...argv],
    { cwd, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(launcher.stdout).text(),
    new Response(launcher.stderr).text(),
    launcher.exited,
  ]);
  const pid = Number(stdout.trim());
  if (code !== 0 || !Number.isInteger(pid) || pid <= 0)
    throw new CloseError(`could not start the resume helper: ${trimmed(stderr) ?? stdout.trim()}`);
  return pid;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}

function kill(pid: number): void {
  try {
    process.kill(pid);
  } catch (error) {
    if (!hasCode(error, "ESRCH")) throw error;
  }
}

export function defaultDeps(): Deps {
  const env = process.env;
  return {
    run: spawnRunner,
    env,
    cwd: process.cwd(),
    dataDir: resolveDataDir(),
    now: () => new Date(),
    wait: (ms) => Bun.sleep(ms),
    out: (line) => {
      console.log(line);
    },
    sender: () => readSender(env, spawnRunner),
    spawnDetached,
    alive,
    kill,
  };
}

export interface Pane {
  mux: PaneMux;
  target: string;
  rexSession: string | null;
}

export interface GitFacts {
  toplevel: string | null;
  branch: string | null;
  head: string | null;
  dirty: number | null;
  ahead: number | null;
}

const NO_GIT: GitFacts = { toplevel: null, branch: null, head: null, dirty: null, ahead: null };

const RexWindow = z.object({ block_ids: z.array(z.string()).min(1) });
const HerdrWorkspace = z.object({
  result: z.object({ root_pane: z.object({ pane_id: z.string() }) }),
});

const EXIT_ATTEMPTS = 600;
const EXIT_INTERVAL_MS = 500;
const FORK_ID = /^[A-Za-z0-9._-]+$/;
const GROUP_CONFLICT = /confirmation_required|workspace_group_close_required/;
const BACKGROUND_REFERENCE = resolve(import.meta.dirname, "..", "references", "background.md");

function present(value: string | undefined): value is string {
  return value != null && value !== "";
}

function trimmed(text: string): string | null {
  const value = text.trim();
  return value === "" ? null : value;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function paneMux(env: Env): PaneMux {
  if (present(env.HC_TERMINAL_ID) && !present(env.REX_BLOCK) && env.HERDR_ENV !== "1")
    throw new CloseError(
      "this session runs in the herdr App, which close does not support yet. Close the pane by hand.",
      2,
    );
  let mux: Mux;
  try {
    mux = detectMux(env);
  } catch (error) {
    throw new CloseError(errorText(error), 2);
  }
  if (mux === "bg") throw new CloseError("no multiplexer hosts this session", 2);
  return mux;
}

export function resolveOwnPane(env: Env): Pane {
  const mux = paneMux(env);
  if (mux === "rex") {
    const { REX_SESSION: session, REX_BLOCK: block } = env;
    if (!present(session) || !present(block))
      throw new CloseError("REX_SESSION and REX_BLOCK must both be set to close a Rex block", 2);
    return { mux, target: block, rexSession: session };
  }
  const pane = env.HERDR_PANE_ID;
  if (!present(pane)) throw new CloseError("HERDR_PANE_ID is not set", 2);
  return { mux, target: pane, rexSession: null };
}

export interface ChildPane {
  pane: Pane;
  path: string | null;
}

export async function resolveChildPane(name: string, deps: Deps): Promise<ChildPane> {
  const sender = await deps.sender();
  const ledger = readLedger(deps.dataDir);
  const index =
    sender == null
      ? -1
      : ledger.findLastIndex(
          (row) =>
            !isClosedRow(row) &&
            row.outcome === "dispatched" &&
            row.name === name &&
            row.sender === sender.name,
        );
  const match = ledger[index];
  if (match == null || isClosedRow(match) || match.target == null || match.mux === "bg")
    throw new CloseError(
      `no pane named ${name} was dispatched by this session, so it cannot be closed from here`,
      2,
    );
  const mux = match.mux;
  const target = match.target;
  // A pane id freed by an earlier close can be reused by an unrelated pane.
  const closed = ledger
    .slice(index + 1)
    .some(
      (row) =>
        isClosedRow(row) && row.event === "closed" && row.mux === mux && row.target === target,
    );
  if (closed) throw new CloseError(`the pane for ${name} was already closed`, 2);
  if (mux === "herdr") return { pane: { mux, target, rexSession: null }, path: match.path };
  const session = deps.env.REX_SESSION;
  if (!present(session)) throw new CloseError("REX_SESSION is not set", 2);
  return { pane: { mux, target, rexSession: session }, path: match.path };
}

export async function gitFacts(run: Runner, cwd: string): Promise<GitFacts> {
  const top = await run(["git", "rev-parse", "--show-toplevel"], { cwd });
  if (top.code !== 0) return NO_GIT;
  const toplevel = trimmed(top.stdout);
  const [branch, head, status, ahead] = await Promise.all([
    run(["git", "branch", "--show-current"], { cwd }),
    run(["git", "rev-parse", "HEAD"], { cwd }),
    run(["git", "status", "--porcelain"], { cwd }),
    run(["git", "rev-list", "--count", "@{u}..HEAD"], { cwd }),
  ]);
  // A branch with no upstream counts the commits missing from every remote-tracking ref.
  const unpushed =
    ahead.code === 0
      ? ahead
      : await run(["git", "rev-list", "--count", "HEAD", "--not", "--remotes"], { cwd });
  const count = Number(unpushed.stdout.trim());
  return {
    toplevel,
    branch: branch.code === 0 ? trimmed(branch.stdout) : null,
    head: head.code === 0 ? trimmed(head.stdout) : null,
    dirty: status.code === 0 ? lines(status.stdout).length : null,
    ahead: unpushed.code === 0 && Number.isInteger(count) ? count : null,
  };
}

export function handoffPrompt(session: string, pr: string): string {
  return `You are the background continuation of session ${session}. Its pane has closed. Follow ${BACKGROUND_REFERENCE} for PR ${pr}.`;
}

export function resumerLog(dataDir: string, session: string): string {
  return join(dataDir, `close-resume-${session}.log`);
}

// Resuming after the foreground process exits keeps the session id. Resuming while it runs starts a copy.
export async function startResumer(
  deps: Deps,
  session: string,
  pr: string,
  cwd: string,
): Promise<number> {
  const pid = processId(deps.env.CLAUDE_PID ?? "");
  if (pid == null)
    throw new CloseError(
      "CLAUDE_PID is not a process id, so the handoff cannot wait for this session to exit",
      2,
    );
  // sh opens the log after it reports the helper's pid, so a missing directory would fail unseen.
  mkdirSync(deps.dataDir, { recursive: true });
  return deps.spawnDetached(
    [
      process.execPath,
      import.meta.path,
      "resume",
      "--session",
      session,
      "--pr",
      pr,
      "--pid",
      String(pid),
    ],
    cwd,
    resumerLog(deps.dataDir, session),
  );
}

function processId(value: string): number | null {
  const pid = Number(value);
  return /^\d+$/.test(value) && pid > 0 ? pid : null;
}

export interface ResumeOptions {
  session: string;
  pr: string;
  pid: number;
}

async function appendEnded(
  options: EndedOptions,
  summary: string | null,
  deps: Deps,
): Promise<ClosedRow> {
  const facts = await gitFacts(deps.run, deps.cwd);
  const row: ClosedRow = {
    event: "ended",
    ts: deps.now().toISOString(),
    session: options.session,
    fork: options.session,
    branch: facts.branch,
    path: facts.toplevel,
    head: facts.head,
    dirty: facts.dirty,
    ahead: facts.ahead,
    pr: options.pr,
    mux: null,
    target: null,
    summary,
    outcome: options.outcome,
  };
  appendDispatch(row, deps.dataDir);
  return row;
}

export async function resumeSession(options: ResumeOptions, deps: Deps): Promise<string> {
  const { session, pr, pid } = options;
  const failed = async (problem: string): Promise<never> => {
    await appendEnded({ session, pr, outcome: "stopped" }, `resume failed: ${problem}`, deps);
    throw new CloseError(problem);
  };

  if (!(await awaitExit(deps, pid)))
    return failed(`session process ${pid} was still running, so it was not resumed`);
  const started = await deps.run(
    ["claude", "--bg", "--resume", session, handoffPrompt(session, pr)],
    {
      cwd: deps.cwd,
      env: detachedEnv(deps.env),
    },
  );
  if (started.code !== 0)
    return failed(`claude --bg failed: ${trimmed(started.stderr) ?? started.stdout.trim()}`);
  const fork = backgroundId(started.stdout);
  if (fork == null)
    return failed(`claude --bg printed no background session id: ${started.stdout.trim()}`);
  deps.out(started.stdout.trim());
  return fork;
}

async function awaitExit(deps: Deps, pid: number, attempts = EXIT_ATTEMPTS): Promise<boolean> {
  if (!deps.alive(pid)) return true;
  if (attempts <= 1) return false;
  await deps.wait(EXIT_INTERVAL_MS);
  return awaitExit(deps, pid, attempts - 1);
}

export interface CloseOptions {
  target?: string;
  handoff?: boolean;
  session?: string;
  pr?: string;
  summary?: string;
}

export interface CloseReport {
  fork: string | null;
  resumer: number | null;
  pane: Pane;
  row: ClosedRow;
}

export async function closePane(options: CloseOptions, deps: Deps): Promise<CloseReport> {
  let handoff: { session: string; pr: string } | null = null;
  if (options.handoff === true) {
    const { target, session, pr } = options;
    if (target != null) throw new CloseError("--handoff cannot be combined with --target", 2);
    if (session == null || pr == null)
      throw new CloseError("--handoff requires --session and --pr", 2);
    handoff = { session, pr };
  }

  const child = options.target == null ? null : await resolveChildPane(options.target, deps);
  const pane = child?.pane ?? resolveOwnPane(deps.env);
  const checkout = child == null ? deps.cwd : child.path;
  const facts = checkout == null ? NO_GIT : await gitFacts(deps.run, checkout);

  const fork = handoff?.session ?? null;
  const resumer =
    handoff == null
      ? null
      : await startResumer(deps, handoff.session, handoff.pr, facts.toplevel ?? deps.cwd);

  const row: ClosedRow = {
    event: "closed",
    ts: deps.now().toISOString(),
    session: options.session ?? "",
    fork,
    branch: facts.branch,
    path: facts.toplevel,
    head: facts.head,
    dirty: facts.dirty,
    ahead: facts.ahead,
    pr: options.pr ?? null,
    mux: pane.mux,
    target: pane.target,
    summary: options.summary ?? null,
  };
  const report: CloseReport = { fork, resumer, pane, row };
  try {
    appendDispatch(row, deps.dataDir);
    // Closing the caller's own pane kills this process. Report before it.
    deps.out(JSON.stringify(report));
    await closeTarget(pane, deps.run);
  } catch (error) {
    withdrawClose(row, resumer, error, deps);
    throw error;
  }
  return report;
}

// When the pane stays open, a waiting resumer would resume a copy once the user quits.
function withdrawClose(row: ClosedRow, resumer: number | null, cause: unknown, deps: Deps): void {
  const reason = `close failed: ${errorText(cause)}`;
  let killError: string | null = null;
  if (resumer != null)
    try {
      deps.kill(resumer);
    } catch (error) {
      killError = errorText(error);
    }
  const summary =
    killError == null ? reason : `${reason}. Stopping resumer ${resumer} failed: ${killError}`;
  try {
    appendDispatch(
      { ...row, event: "ended", ts: deps.now().toISOString(), outcome: "stopped", summary },
      deps.dataDir,
    );
  } catch {
    // The ledger itself may be what failed, and the stop result still has to reach the caller.
  }
  if (killError != null)
    throw new CloseError(`${summary}. Kill process ${resumer} by hand before this session exits.`);
}

async function closeTarget(pane: Pane, run: Runner): Promise<void> {
  const argv =
    pane.mux === "rex"
      ? ["rex", "block", "close", "-s", pane.rexSession ?? "", pane.target]
      : ["herdr", "pane", "close", pane.target];
  const result = await run(argv);
  if (GROUP_CONFLICT.test(`${result.stdout}\n${result.stderr}`))
    throw new CloseError(
      "the pane is in a linked worktree group, so herdr will not close it without --group. Leaving it open.",
    );
  if (result.code !== 0)
    throw new CloseError(`${argv.slice(0, 3).join(" ")} failed: ${result.stderr.trim()}`);
}

function parseJson<T>(schema: z.ZodType<T>, text: string, label: string): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    throw new CloseError(`${label} returned an unexpected shape: ${errorText(error)}`);
  }
}

export async function attachFork(
  fork: string,
  deps: Deps,
): Promise<{ mux: PaneMux; pane: string }> {
  if (!FORK_ID.test(fork)) throw new CloseError(`${fork} is not a background session id`, 2);
  const mux = paneMux(deps.env);
  const label = `attach-${fork}`;
  if (mux === "rex") {
    // The fork inherited the closed pane's REX_BLOCK, so only the session is usable.
    const session = deps.env.REX_SESSION;
    if (!present(session)) throw new CloseError("REX_SESSION is not set", 2);
    const created = await deps.run([
      "rex",
      "window",
      "new",
      "-s",
      session,
      label,
      "--focus=false",
      "--json",
      "--",
      "claude",
      "attach",
      fork,
    ]);
    if (created.code !== 0) throw new CloseError(`rex window new failed: ${created.stderr.trim()}`);
    const { block_ids } = parseJson(RexWindow, created.stdout, "rex window new");
    return { mux, pane: block_ids[0] ?? "" };
  }
  const workspace = await deps.run([
    "herdr",
    "workspace",
    "create",
    "--cwd",
    deps.cwd,
    "--label",
    label,
    "--no-focus",
  ]);
  if (workspace.code !== 0)
    throw new CloseError(`herdr workspace create failed: ${workspace.stderr.trim()}`);
  const pane = parseJson(HerdrWorkspace, workspace.stdout, "herdr workspace create").result
    .root_pane.pane_id;
  const ran = await deps.run(["herdr", "pane", "run", pane, `claude attach ${fork}`]);
  if (ran.code !== 0) throw new CloseError(`herdr pane run failed: ${ran.stderr.trim()}`);
  return { mux, pane };
}

export interface EndedOptions {
  session: string;
  pr: string;
  outcome: "merged" | "closed" | "stopped";
}

export function recordEnded(options: EndedOptions, deps: Deps): Promise<ClosedRow> {
  return appendEnded(options, null, deps);
}

export function leftBehind(rows: readonly ClosedRow[]): ClosedRow[] {
  const latest = new Map<string, ClosedRow>();
  for (const row of rows) {
    const key = row.path ?? row.branch ?? row.ts;
    latest.delete(key);
    latest.set(key, row);
  }
  return [...latest.values()].filter((row) => (row.dirty ?? 0) > 0 || (row.ahead ?? 0) > 0);
}

export function closedRows(dataDir: string, onlyLeftBehind: boolean): ClosedRow[] {
  const rows = readLedger(dataDir).filter(isClosedRow);
  return onlyLeftBehind ? leftBehind(rows) : rows;
}

async function guarded(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof CloseError)) throw error;
    console.error(error.message);
    process.exitCode = error.exitCode;
  }
}

export function createProgram(deps: Deps): Command {
  const close = new Command("close")
    .description("Close this session's pane, or a pane it dispatched.")
    .option("--target <name>", "name of a session this one dispatched")
    .option("--handoff", "continue in a background session before closing")
    .option("--session <id>", "this session's id")
    .option("--pr <url>", "pull request the background session watches")
    .option("--summary <text>", "one to three lines on what the session did")
    .action((options) => guarded(async () => void (await closePane(options, deps))));

  const attach = new Command("attach")
    .description("Open an unfocused pane attached to a background session.")
    .requiredOption("--session <fork>", "background session id")
    .action((options) =>
      guarded(async () => {
        deps.out(JSON.stringify(await attachFork(options.session, deps)));
      }),
    );

  const ended = new Command("ended")
    .description("Record that a background session finished watching its PR.")
    .requiredOption("--session <fork>", "background session id")
    .requiredOption("--pr <url>", "pull request URL")
    .addOption(
      new Option("--outcome <outcome>", "how the watch ended")
        .choices(["merged", "closed", "stopped"] as const)
        .makeOptionMandatory(),
    )
    .action((options) =>
      guarded(async () => {
        const { session, pr, outcome } = options;
        const row = await recordEnded({ session, pr, outcome }, deps);
        deps.out(JSON.stringify(row));
      }),
    );

  const resume = new Command("resume")
    .description("Wait for a closed session's process to exit, then resume it in the background.")
    .requiredOption("--session <id>", "session id to resume")
    .requiredOption("--pr <url>", "pull request the background session watches")
    .requiredOption("--pid <pid>", "process id of the session's foreground claude", (value) => {
      const pid = processId(value);
      if (pid == null) throw new InvalidArgumentError(`${value} is not a process id`);
      return pid;
    })
    .action((options) => guarded(async () => void (await resumeSession(options, deps))));

  const report = new Command("report")
    .description("Print the ledger's close rows as JSON lines.")
    .option("--left-behind", "only branches whose latest row has dirty or unpushed work")
    .action((options) => {
      for (const row of closedRows(deps.dataDir, options.leftBehind === true))
        deps.out(JSON.stringify(row));
    });

  return new Command("close")
    .description("Close an agent's own pane, handing the session to the background first.")
    .enablePositionalOptions()
    .addCommand(close)
    .addCommand(attach)
    .addCommand(ended)
    .addCommand(resume)
    .addCommand(report);
}

if (import.meta.main) {
  await createProgram(defaultDeps()).parseAsync();
}
