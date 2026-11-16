#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the dispatch ledger under ~/.claude/plugins and reaches the claude daemon and multiplexer sockets
import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { readSender, type Sender, spawnRunner } from "../../dispatch/scripts/dispatch";
import {
  appendDispatch,
  type ClosedRow,
  isClosedRow,
  readLedger,
  resolveDataDir,
} from "../../dispatch/scripts/ledger";
import { CloseError, errorText } from "./errors";
import { gitFacts, NO_GIT } from "./git";
import type { Pane, PaneMux } from "./muxer";
import { hostMuxer, muxer } from "./muxers";
import {
  alive,
  kill,
  processId,
  recordEnded,
  type ResumeDeps,
  resumeSession,
  spawnDetached,
  startResumer,
} from "./resume";
import { closedRow, closedRows } from "./rows";

export interface Deps extends ResumeDeps {
  sender: () => Promise<Sender | null>;
  kill: (pid: number) => void;
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

interface ChildPane extends Pane {
  path: string | null;
}

const FORK_ID = /^[A-Za-z0-9._-]+$/;

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
  return { mux, target, path: match.path };
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

function handoffOf(options: CloseOptions): { session: string; pr: string } | null {
  if (options.handoff !== true) return null;
  const { target, session, pr } = options;
  if (target != null) throw new CloseError("--handoff cannot be combined with --target", 2);
  if (session == null || pr == null)
    throw new CloseError("--handoff requires --session and --pr", 2);
  return { session, pr };
}

export async function closeSession(options: CloseOptions, deps: Deps): Promise<CloseReport> {
  const handoff = handoffOf(options);
  const child = options.target == null ? null : await resolveChildPane(options.target, deps);
  const host = child == null ? hostMuxer(deps) : muxer(child.mux, deps);
  const pane: Pane = { mux: host.kind, target: child?.target ?? host.ownPane() };
  const checkout = child == null ? deps.cwd : child.path;
  const facts = checkout == null ? NO_GIT : await gitFacts(deps.run, checkout);

  const fork = handoff?.session ?? null;
  const resumer =
    handoff == null
      ? null
      : await startResumer(deps, handoff.session, handoff.pr, facts.toplevel ?? deps.cwd);

  const row = closedRow(
    facts,
    {
      ts: deps.now().toISOString(),
      session: options.session ?? "",
      fork,
      pr: options.pr ?? null,
      summary: options.summary ?? null,
    },
    pane,
  );
  const report: CloseReport = { fork, resumer, pane, row };
  try {
    appendDispatch(row, deps.dataDir);
    // Closing the caller's own pane kills this process. Report before it.
    deps.out(JSON.stringify(report));
    await host.closePane(pane.target);
  } catch (error) {
    withdrawClose(row, resumer, error, deps);
    throw error;
  }
  return report;
}

// When the pane stays open, a waiting resumer would resume a copy once the user quits.
function withdrawClose(row: ClosedRow, resumer: number | null, cause: unknown, deps: Deps): void {
  let summary = `close failed: ${errorText(cause)}`;
  let stuck = false;
  if (resumer != null)
    try {
      deps.kill(resumer);
    } catch (error) {
      summary += `. Stopping resumer ${resumer} failed: ${errorText(error)}`;
      stuck = true;
    }
  try {
    appendDispatch(
      { ...row, event: "ended", ts: deps.now().toISOString(), outcome: "stopped", summary },
      deps.dataDir,
    );
  } catch {
    // The ledger itself may be what failed, and the stop result still has to reach the caller.
  }
  if (stuck)
    throw new CloseError(`${summary}. Kill process ${resumer} by hand before this session exits.`);
}

export async function attachSession(
  fork: string,
  deps: Deps,
): Promise<{ mux: PaneMux; pane: string }> {
  if (!FORK_ID.test(fork)) throw new CloseError(`${fork} is not a background session id`, 2);
  const host = hostMuxer(deps);
  return { mux: host.kind, pane: await host.openAttachPane(fork) };
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
    .action((options) => guarded(async () => void (await closeSession(options, deps))));

  const attach = new Command("attach")
    .description("Open an unfocused pane attached to a background session.")
    .requiredOption("--session <fork>", "background session id")
    .action((options) =>
      guarded(async () => {
        deps.out(JSON.stringify(await attachSession(options.session, deps)));
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
        deps.out(JSON.stringify(await recordEnded({ session, pr, outcome }, deps)));
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
