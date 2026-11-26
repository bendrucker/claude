#!/usr/bin/env bun
import { isAbsolute } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import {
  AgentList,
  agentNames,
  awaitStatus,
  claudeArgs,
  type Context,
  launchBackground,
  launchHerdr,
  launchRex,
  localPoll,
  pollRex,
  pollScreen,
  RexCreated,
} from "./launch";
import { appendDispatch, type DispatchLedgerRow, resolveDataDir } from "./ledger";
import { describeMuxDefault, detectMux, type Mux, MUXES } from "./mux";
import { deriveName, deriveTitle, taskSummary, titleOf } from "./naming";
import {
  DispatchError,
  type DispatchOptions,
  type DispatchRecord,
  type DispatchResult,
  formatRecord,
  placeOf,
  type WorktreeOptions,
} from "./record";
import { type ResolveRepo, resolveRepo } from "./repo";
import { requiredJson } from "./required";
import { type Pause, type Runner, spawnRunner } from "./runner";
import { readSender, withSender } from "./sender";
import { createSessionsCommand, currentSession, resolveSessionLabel } from "./sessions";
import {
  mergeSettings,
  parseSettings,
  type Settings,
  settingsKeys,
  settingsPatch,
} from "./settings";
import { CHANGE_PATTERN, type Probe, prepareWorktree, probeWorktreeAdmin } from "./worktree";

export * from "./mux";
export * from "./naming";
export * from "./record";
export * from "./runner";
export * from "./sender";
export * from "./settings";
export * from "./status";
// worktree.ts also exports internals, so only its public names pass through.
export { fetchArgs, type Probe, probeWorktreeAdmin } from "./worktree";

const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_TITLE = 60;
// The prompt travels as one argv element, and the whole argv shares an
// operating-system limit that a large paste can exhaust.
const MAX_PROMPT_BYTES = 128 * 1024;
// Linux caps one argv element at 128KB including its terminator.
const MAX_ARG_BYTES = 128 * 1024 - 1;
// rex passes words without a shell. This launcher's own shell expands $HOME.
const REMOTE_LAUNCHER = [
  'script="$HOME/.claude-repo/plugins/dispatch/skills/dispatch/scripts/dispatch.ts"',
  'command -v bun >/dev/null 2>&1 || { echo "dispatch failed: bun is not on PATH"; exit 1; }',
  '[ -f "$script" ] || { echo "dispatch failed: $script is not deployed"; exit 1; }',
  'exec bun "$script" "$@"',
].join("; ");

// Base64 keeps a prompt or settings file one opaque word on its way through rex.
export function encodeArg(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export function decodeArg(value: string, label: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error(`${label} is not base64`);
  return Buffer.from(value, "base64").toString("utf8");
}

function validateCommon(
  options: WorktreeOptions & { prompt: string; name?: string | undefined },
): void {
  if (!BRANCH_PATTERN.test(options.branch) && !CHANGE_PATTERN.test(options.branch))
    throw new DispatchError(
      `branch ${JSON.stringify(options.branch)} must match ${BRANCH_PATTERN.source} or ${CHANGE_PATTERN.source}`,
      null,
    );
  if (options.name != null && !AGENT_NAME_PATTERN.test(options.name))
    throw new DispatchError(
      `agent name ${JSON.stringify(options.name)} must match ${AGENT_NAME_PATTERN.source}`,
      null,
    );
  // A ref may hold ~, ^, and @{}, so only a leading dash that a parser would
  // read as a flag is out.
  if (options.base != null && (options.base.startsWith("-") || options.base.trim() === ""))
    throw new DispatchError(`base ${JSON.stringify(options.base)} must name a ref`, null);
  const promptBytes = Buffer.byteLength(options.prompt);
  if (promptBytes > MAX_PROMPT_BYTES)
    throw new DispatchError(
      `the prompt is ${promptBytes} bytes, over the ${MAX_PROMPT_BYTES} an argument carries. Point the session at a file instead of pasting its contents.`,
      null,
    );
}

function validate(options: DispatchOptions): void {
  validateCommon(options);
  if (options.title != null && (options.title.trim() === "" || /[\n\r]/.test(options.title)))
    throw new DispatchError("--title must be one non-empty line", null);
  if (options.title != null && options.title.length > MAX_TITLE)
    throw new DispatchError(`--title must be at most ${MAX_TITLE} characters`, null);
  if (options.host != null) {
    validateRemote(options, options.host);
    return;
  }
  if (options.split === true && options.mux !== "rex")
    throw new DispatchError("--split needs --mux rex", null);
  if (options.mux === "rex" && options.split === true && (options.rexBlock ?? "") === "")
    throw new DispatchError("--split needs REX_BLOCK to name the block to split", null);
  if (options.mux === "rex" && options.split !== true && (options.rexSession ?? "") === "")
    throw new DispatchError(
      "a Rex tab needs a session: pass --session <id or label> (`rex ls` lists them)",
      null,
    );
}

function validateRemote(options: DispatchOptions, host: string): void {
  if (options.mux !== "rex") throw new DispatchError("--host needs --mux rex", null);
  if (options.split === true)
    throw new DispatchError("--split opens beside this block, so it cannot take --host", null);
  if ((options.rexSession ?? "") === "")
    throw new DispatchError(
      `--host needs --session naming a session on ${host} (\`rex -S ${host} ls\` lists them)`,
      null,
    );
  const encoded = [
    ["the prompt", encodeArg(options.prompt)],
    ["the settings", encodeArg(JSON.stringify(options.settings ?? {}))],
  ] as const;
  for (const [label, value] of encoded)
    if (value.length > MAX_ARG_BYTES)
      throw new DispatchError(
        `${label} encodes to ${value.length} bytes, over the ${MAX_ARG_BYTES} one argument carries to another machine`,
        null,
      );
}

// The words after `rex window new --`, which run the launcher on the host.
export function remoteCommand(options: DispatchOptions, name: string): string[] {
  const settings = options.settings ?? {};
  return [
    "sh",
    "-c",
    REMOTE_LAUNCHER,
    "dispatch",
    "--exec",
    "--repo",
    options.repo,
    "--branch",
    options.branch,
    ...(options.base == null ? [] : ["--base", options.base]),
    "--name",
    name,
    "--timeout",
    String(options.timeout),
    "--prompt-base64",
    encodeArg(options.prompt),
    ...(Object.keys(settings).length > 0
      ? ["--settings-base64", encodeArg(JSON.stringify(settings))]
      : []),
  ];
}

async function dispatchRemote(
  options: DispatchOptions,
  host: string,
  run: Runner,
  pause: Pause,
): Promise<DispatchResult> {
  const name = options.name ?? deriveName(options.branch, new Set());
  const title = titleOf(options);
  const created = await requiredJson(
    run,
    [
      "rex",
      "-S",
      host,
      "window",
      "new",
      "-s",
      options.rexSession ?? "",
      title,
      ...(isAbsolute(options.repo) ? ["-c", options.repo] : []),
      "--keep-open",
      "--focus=false",
      "--json",
      "--",
      ...remoteCommand(options, name),
    ],
    RexCreated,
    null,
  );
  const record: DispatchRecord = {
    mux: "rex",
    target: created.block_ids[0] ?? null,
    host,
    name,
    title,
    place: "tab",
    path: null,
    branch: options.branch,
    session: null,
    status: "unknown",
    settings: settingsKeys(options.settings ?? {}),
  };
  const server = ["-S", host];
  record.status = await awaitStatus(
    (last) => pollRex(run, record, server, last),
    pause,
    options.timeout,
  );
  // A program status report skips the screen, which is where the path shows.
  if (record.path == null)
    await pollScreen(run, record, [
      "rex",
      ...server,
      "capture",
      "-b",
      record.target ?? "",
      "--trim",
    ]);
  return { root: options.repo, record };
}

export async function dispatch(
  options: DispatchOptions,
  run: Runner = spawnRunner,
  pause: Pause = Bun.sleep,
  probe: Probe = probeWorktreeAdmin,
  resolve: ResolveRepo = resolveRepo,
): Promise<DispatchResult> {
  validate(options);
  if (options.host != null) return dispatchRemote(options, options.host, run, pause);

  // A herdr name already bound would fail agent start after the worktree
  // exists, so the live names are read before anything is created.
  const taken =
    options.mux === "herdr"
      ? agentNames(await requiredJson(run, ["herdr", "agent", "list"], AgentList, null))
      : new Set<string>();
  const wanted = options.name ?? deriveName(options.branch, taken);
  if (taken.has(wanted))
    throw new DispatchError(
      `agent name ${JSON.stringify(wanted)} is already bound to a live agent`,
      null,
    );

  const { root, path, partial } = await prepareWorktree(
    options,
    { name: wanted, mux: options.mux, title: titleOf(options), place: placeOf(options) },
    run,
    pause,
    probe,
    resolve,
  );
  try {
    const ctx: Context = { run, pause, options, partial, path };
    const launch = { rex: launchRex, herdr: launchHerdr, bg: launchBackground }[options.mux];
    await launch(ctx);
    partial.status = await awaitStatus(localPoll(ctx), pause, options.timeout);
    return { root, record: partial };
  } catch (error) {
    if (error instanceof DispatchError) error.root ??= root;
    throw error;
  }
}

export type Start = (argv: readonly string[], cwd: string) => Promise<number>;

const inheritStart: Start = async (argv, cwd) =>
  Bun.spawn([...argv], { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;

export interface ExecOptions extends WorktreeOptions {
  prompt: string;
  name: string;
}

// The far side of --host. It owns the terminal rex opened, and Remote Control
// puts the session in the caller's ListAgents.
export async function execSession(
  options: ExecOptions,
  run: Runner = spawnRunner,
  pause: Pause = Bun.sleep,
  start: Start = inheritStart,
  probe: Probe = probeWorktreeAdmin,
  resolve: ResolveRepo = resolveRepo,
): Promise<number> {
  validateCommon(options);
  const { path, partial } = await prepareWorktree(
    options,
    { name: options.name, mux: "rex", title: deriveTitle(options.branch), place: "tab" },
    run,
    pause,
    probe,
    resolve,
  );
  process.stdout.write(`dispatch worktree: ${path}\ndispatch branch: ${partial.branch}\n`);
  if (partial.submoduleError != null)
    process.stderr.write(`warning: submodules were not initialized: ${partial.submoduleError}\n`);
  return start(
    ["claude", ...claudeArgs(options.name, options.prompt, ["--remote-control", options.name])],
    path,
  );
}

async function readPrompt(path: string | undefined): Promise<string> {
  if (path == null || path === "") return Bun.stdin.text();
  return Bun.file(path)
    .text()
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`cannot read the prompt at ${path}: ${reason}\n`);
      process.exit(2);
    });
}

function inspectHint(record: DispatchRecord): string {
  if (record.mux === "rex" && record.host != null)
    return `rex -S ${record.host} capture -b ${record.target ?? "<block>"} --trim`;
  if (record.mux === "rex") return `rex capture -b ${record.target ?? "<block>"} --trim`;
  if (record.mux === "bg") return `claude logs ${record.target ?? record.name}`;
  return `herdr agent read ${record.name}`;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("dispatch")
  .description(
    "Check out a branch, PR, or MR in a worktree with wt, write its local Claude settings, and start `claude --name <name> <prompt>` in a new Rex tab or herdr workspace. The repository's own checkout is never moved.",
  )
  .option(
    "--repo <repo>",
    "Repository to branch from: a path, an owner/name slug, or a GitHub URL. A missing checkout is cloned to ~/src/<upstream owner>/<name>, through your fork when you cannot push upstream",
    process.cwd(),
  )
  .option(
    "--branch <branch>",
    "Branch for the session, created when it exists nowhere, or a pr:<n>, mr:<n>, or PR/MR URL (required)",
  )
  .option("--prompt <file>", "File holding the prompt; reads stdin when absent")
  .option("--name <name>", "Session name; derived from the branch when absent")
  .option(
    "--title <title>",
    "Rex tab or pane label, two to four Title Case words naming the task; derived from the branch when absent",
  )
  .option(
    "--keep-open",
    "Leave out the prompt's instruction to run dispatch:close once the PR is open",
    false,
  )
  .option(
    "--base <ref>",
    "Ref a newly created branch starts from; defaults to the upstream remote's default branch when the checkout has one, origin/main otherwise",
  )
  .option("--mux <mux>", `rex, herdr, or bg (claude --bg); ${describeMuxDefault(process.env)}`)
  .option(
    "--session <session>",
    "Rex session ID or label for the new tab; defaults to this pane's session",
  )
  .option(
    "--split",
    "Rex only: open a pane in this tab, beside the current block at 160 columns or more and below it otherwise, instead of a new tab",
    false,
  )
  .option("--allow <rule>", "Permission rule for permissions.allow (repeatable)", collect, [])
  .option(
    "--sandbox-write <path>",
    "Path for sandbox.filesystem.allowWrite (repeatable)",
    collect,
    [],
  )
  .option(
    "--settings-json <file>",
    "JSON file deep-merged into the worktree's .claude/settings.local.json",
  )
  .option(
    "--host <label>",
    "Rex only: saved host label (`rex hosts list`) to run the session on; --repo is a path there",
  )
  .option(
    "--exec",
    "Internal: the --host side. Prepare the worktree here and run claude in the foreground",
    false,
  )
  .option("--prompt-base64 <text>", "Internal: --exec prompt, base64")
  .option("--settings-base64 <text>", "Internal: --exec settings JSON, base64")
  .option("--data-dir <dir>", "Dispatch ledger directory; defaults to the plugin data dir")
  // Number, not a throwing parser: the action reports a non-number with the
  // other --timeout check, as a usage error that exits 2.
  .option("--timeout <ms>", "Milliseconds to wait for the session to start working", Number, 30_000)
  .action(async (flags) => {
    // The caller's poll reads this screen, so every failure prints its marker.
    if (flags.exec) {
      try {
        const { branch, name, promptBase64, settingsBase64 } = flags;
        if (branch == null || branch === "") throw new Error("--branch is required");
        if (name == null || name === "") throw new Error("--name is required");
        if (promptBase64 == null) throw new Error("--prompt-base64 is required");
        const settings =
          settingsBase64 == null
            ? {}
            : parseSettings(decodeArg(settingsBase64, "--settings-base64"), "--settings-base64");
        process.exit(
          await execSession({
            repo: flags.repo,
            branch,
            base: flags.base,
            timeout: flags.timeout,
            name,
            prompt: decodeArg(promptBase64, "--prompt-base64"),
            settings,
          }),
        );
      } catch (error) {
        process.stdout.write(
          `dispatch failed: ${error instanceof Error ? error.message.trim() : String(error)}\n`,
        );
        if (error instanceof DispatchError && error.partial != null)
          process.stdout.write(`${formatRecord(error.partial)}\n`);
        process.exit(1);
      }
    }

    if (flags.branch == null || flags.branch === "") {
      process.stderr.write("--branch is required\n");
      program.outputHelp();
      process.exit(2);
    }

    if (!Number.isFinite(flags.timeout) || flags.timeout <= 0) {
      process.stderr.write("--timeout must be a positive number of milliseconds\n");
      process.exit(2);
    }

    const muxFlag = z.enum(MUXES).optional().safeParse(flags.mux);
    if (!muxFlag.success) {
      process.stderr.write(`--mux must be one of ${MUXES.join(", ")}\n`);
      process.exit(2);
    }
    let mux: Mux;
    try {
      mux = muxFlag.data ?? detectMux(process.env);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }

    let settings: Settings;
    try {
      const extra =
        flags.settingsJson == null
          ? {}
          : parseSettings(await Bun.file(flags.settingsJson).text(), flags.settingsJson);
      settings = mergeSettings(extra, settingsPatch(flags.allow, flags.sandboxWrite));
    } catch (error) {
      process.stderr.write(
        `cannot read --settings-json: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(2);
    }

    const prompt = await readPrompt(flags.prompt);
    if (prompt.trim() === "") {
      process.stderr.write("the prompt is empty; pass --prompt <file> or pipe it on stdin\n");
      process.exit(2);
    }
    const sender = await readSender(process.env);
    // This pane's session is on this machine, never the host's.
    const rexSessionValue =
      flags.session ??
      (flags.host == null && mux === "rex"
        ? await currentSession(process.env, spawnRunner)
        : undefined);
    const rexSession =
      mux === "rex" && rexSessionValue != null && rexSessionValue !== "" && flags.host == null
        ? await resolveSessionLabel(spawnRunner, rexSessionValue)
        : undefined;

    // The session is already running and the caller needs its identifiers, so a
    // ledger failure warns rather than failing the dispatch.
    const writeLedger = (
      record: DispatchRecord,
      repo: string,
      outcome: "dispatched" | "orphaned" | "failed",
    ) => {
      try {
        const row: DispatchLedgerRow = {
          ts: new Date().toISOString(),
          task: taskSummary(prompt),
          repo,
          branch: record.branch,
          path: record.path,
          mux: record.mux,
          target: record.target,
          host: record.host,
          name: record.name,
          title: record.title,
          place: record.place,
          session: record.session,
          sender: sender?.name ?? null,
          outcome,
        };
        if (rexSession != null) row.rexSession = rexSession;
        appendDispatch(row, resolveDataDir(flags.dataDir));
      } catch (error) {
        process.stderr.write(
          `warning: dispatch ledger not written: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    };

    try {
      const { record, root } = await dispatch({
        repo: flags.repo,
        branch: flags.branch,
        prompt: withSender(prompt, sender, !flags.keepOpen && mux !== "bg"),
        name: flags.name,
        title: flags.title,
        base: flags.base,
        timeout: flags.timeout,
        mux,
        split: flags.split,
        rexSession: rexSessionValue,
        host: flags.host,
        rexBlock: process.env.REX_BLOCK,
        settings,
      });

      if (record.submoduleError != null)
        process.stderr.write(
          `warning: submodules in ${record.path} were not initialized: ${record.submoduleError}\n`,
        );
      if (record.status !== "working")
        process.stderr.write(
          `warning: ${record.name} is ${record.status} after ${flags.timeout}ms. Read its screen with \`${inspectHint(record)}\`.\n`,
        );

      writeLedger(record, root, "dispatched");
      process.stdout.write(`${formatRecord(record)}\n`);
    } catch (error) {
      if (!(error instanceof DispatchError)) throw error;
      process.stderr.write(error.message.endsWith("\n") ? error.message : `${error.message}\n`);
      // The record reaches the caller before the ledger is touched, so a ledger
      // failure cannot cost them the only copy of it.
      if (error.partial != null) {
        process.stderr.write(`${formatRecord(error.partial)}\n`);
        // A worktree that predates the dispatch still has an owner.
        const outcome = error.partial.checkout === "existing-worktree" ? "failed" : "orphaned";
        writeLedger(error.partial, error.root ?? flags.repo, outcome);
      }
      process.exit(1);
    }
  });

if (import.meta.main && process.argv[2] === "sessions") {
  await createSessionsCommand(spawnRunner).parseAsync(process.argv.slice(3), { from: "user" });
} else if (import.meta.main) {
  await program.parseAsync();
}
