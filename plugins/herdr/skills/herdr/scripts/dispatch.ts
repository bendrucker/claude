#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the dispatch ledger in the plugin data dir under ~/.claude/plugins
import { cli } from "cleye";
import { z } from "zod";
import { appendDispatch, resolveDataDir } from "./ledger";

const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_AGENT_NAME = 32;
const MAX_TASK_SUMMARY = 120;
// The prompt travels as one argv element, and the whole argv shares an
// operating-system limit that a large paste can exhaust.
const MAX_PROMPT_BYTES = 128 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
const NAME_ATTEMPTS = 3;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  // Kills the process after this many milliseconds. A fetch over SSH waits on
  // an agent that may be waiting on a hardware key, which never returns
  // unattended.
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type Runner = (argv: readonly string[], options?: RunOptions) => Promise<CommandResult>;

// The sandbox marker covers the whole invocation, so every subprocess takes an argv array.
export const spawnRunner: Runner = async (argv, options) => {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: options?.env == null ? undefined : { ...process.env, ...options.env },
    });
  } catch (error) {
    // Spawning throws when the binary is missing, which would escape the
    // DispatchError contract and lose the partial record with it.
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 127, stdout: "", stderr: `${argv[0]}: ${reason}\n` };
  }
  const timer =
    options?.timeoutMs == null ? null : setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    // A signal is how the kill above shows up, and the process itself writes
    // nothing to explain why it stopped.
    if (options?.timeoutMs == null || proc.signalCode == null) return { code, stdout, stderr };
    return {
      code: code === 0 ? 124 : code,
      stdout,
      stderr: `${stderr}${argv[0]}: killed after ${options.timeoutMs}ms\n`,
    };
  } finally {
    if (timer != null) clearTimeout(timer);
  }
};

export interface DispatchRecord {
  workspace: string;
  pane: string;
  agent: string | null;
  path: string;
  branch: string;
  session: string | null;
  status: string;
  // False when a trust or permission dialog held the agent at start, so the
  // worktree and the name exist but the agent never received the work.
  prompted: boolean;
}

export interface DispatchResult {
  record: DispatchRecord;
  root: string;
}

// A partial record means a worktree exists that nobody owns.
export class DispatchError extends Error {
  readonly partial: DispatchRecord | null;
  // The primary checkout, filled in once dispatch has resolved it, so a
  // partial record reaches the ledger with the repository it belongs to.
  root: string | null = null;

  constructor(message: string, partial: DispatchRecord | null) {
    super(message);
    this.name = "DispatchError";
    this.partial = partial;
  }
}

const WorktreeCreated = z.object({
  result: z.object({
    workspace: z.object({ workspace_id: z.string() }),
    root_pane: z.object({ pane_id: z.string() }),
    worktree: z.object({ path: z.string() }),
  }),
});

const AgentList = z.object({
  result: z.object({
    agents: z.array(z.object({ name: z.string().nullish() })),
  }),
});

const AgentInfo = z.object({
  result: z.object({
    agent: z.object({
      agent_status: z.string(),
      agent_session: z.object({ value: z.string() }).nullish(),
    }),
  }),
});

const AgentStarted = z.object({
  result: z.object({ agent: z.object({ agent_status: z.string() }) }),
});

const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// herdr writes its JSON envelope on stderr, sometimes behind other output, so
// the last line is tried after the whole stream.
export function envelopeCode(stderr: string): string | null {
  const lastLine = stderr.split("\n").findLast((line) => line.trim() !== "");
  return readEnvelope(stderr) ?? (lastLine == null ? null : readEnvelope(lastLine));
}

function readEnvelope(text: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ErrorEnvelope.safeParse(json);
  return parsed.success ? parsed.data.error.code : null;
}

export function deriveName(branch: string, taken: ReadonlySet<string>): string {
  const slug = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, MAX_AGENT_NAME);
  const base = slug === "" ? "agent" : slug;

  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) {
    const suffix = `-${n}`;
    candidate = base.slice(0, MAX_AGENT_NAME - suffix.length) + suffix;
  }
  return candidate;
}

export function taskSummary(prompt: string): string {
  // A prompt file often opens with a heading or a rule, so the summary is the
  // first line that still carries words once the markup is off the front.
  const line =
    prompt
      .split("\n")
      .map((entry) => entry.replace(/^[\s>#*+-]+/, "").trim())
      .find((entry) => /\w/.test(entry)) ?? "";
  return line.slice(0, MAX_TASK_SUMMARY);
}

export function formatRecord(record: DispatchRecord): string {
  return JSON.stringify(record);
}

function decode<T>(
  schema: z.ZodType<T>,
  result: CommandResult,
  label: string,
  partial: DispatchRecord | null,
): T {
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new DispatchError(
      `${label} did not return JSON: ${result.stdout.slice(0, 200)}`,
      partial,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new DispatchError(
      `${label} returned an unexpected shape: ${parsed.error.message}`,
      partial,
    );
  return parsed.data;
}

// A step whose failure the caller can recover from: it succeeded, or herdr
// named a code the caller tolerates.
function fatal(result: CommandResult, ...tolerated: readonly string[]): boolean {
  if (result.code === 0) return false;
  const code = envelopeCode(result.stderr);
  return code == null || !tolerated.includes(code);
}

async function required(
  run: Runner,
  argv: readonly string[],
  partial: DispatchRecord | null,
  options?: RunOptions,
): Promise<CommandResult> {
  const result = await run(argv, options);
  if (result.code !== 0)
    throw new DispatchError(
      result.stderr.trim() === "" ? `${argv.join(" ")} exited ${result.code}` : result.stderr,
      partial,
    );
  return result;
}

async function requiredJson<T>(
  run: Runner,
  argv: readonly string[],
  schema: z.ZodType<T>,
  partial: DispatchRecord | null,
): Promise<T> {
  return decode(schema, await required(run, argv, partial), argv.slice(0, 3).join(" "), partial);
}

// A base like origin/main needs its remote updated first. A local ref names no
// remote, and fetching one the repository does not have would fail the dispatch.
async function baseRemote(run: Runner, root: string, base: string): Promise<string | null> {
  const candidate = base.split("/")[0];
  if (candidate == null || candidate === base) return null;
  const listed = await required(run, ["git", "-C", root, "remote"], null);
  const remotes = new Set(listed.stdout.split("\n").map((line) => line.trim()));
  return remotes.has(candidate) ? candidate : null;
}

function agentNames(listed: z.infer<typeof AgentList>): ReadonlySet<string> {
  return new Set(listed.result.agents.flatMap((agent) => (agent.name == null ? [] : [agent.name])));
}

// A derived name can be bound by another dispatch between the list above and
// this start, and herdr names that race. The worktree already exists by then,
// so the dispatch takes the next free name rather than leaving it without an
// agent. The replacement can lose the same race, so the retry is bounded. A
// name the caller asked for has no substitute.
async function startNamed(
  run: Runner,
  options: DispatchOptions,
  partial: DispatchRecord,
  name: string,
  attempt = 1,
): Promise<{ name: string; started: CommandResult }> {
  const started = await run([
    "herdr",
    "agent",
    "start",
    name,
    "--kind",
    "claude",
    "--pane",
    partial.pane,
  ]);
  if (
    options.name != null ||
    attempt >= NAME_ATTEMPTS ||
    envelopeCode(started.stderr) !== "agent_name_taken"
  )
    return { name, started };

  const live = agentNames(await requiredJson(run, ["herdr", "agent", "list"], AgentList, partial));
  return startNamed(run, options, partial, deriveName(options.branch, live), attempt + 1);
}

// agent prompt --wait does not track turns, so a startup turn still running
// would satisfy --until working and report work the agent never took. A
// submission from idle is what makes the observed transition this prompt's.
async function deliver(
  run: Runner,
  name: string,
  options: DispatchOptions,
  partial: DispatchRecord,
  started: CommandResult,
): Promise<boolean> {
  const info = decode(AgentStarted, started, "herdr agent start", partial);
  if (info.result.agent.agent_status !== "idle") {
    const settled = await run([
      "herdr",
      "agent",
      "wait",
      name,
      "--until",
      "idle",
      "--timeout",
      String(options.timeout),
    ]);
    if (settled.code !== 0) return false;
  }

  const submitted = await run([
    "herdr",
    "agent",
    "prompt",
    name,
    options.prompt,
    "--wait",
    "--until",
    "working",
    "--timeout",
    String(options.timeout),
  ]);
  // Neither tolerated code confirms delivery. agent_prompt_stalled means
  // nothing was observed after the paste, which a fast turn and a lost Enter
  // both produce. A timeout under --until working means the agent reached
  // blocked and stayed there, where a dialog may be holding the prompt.
  if (fatal(submitted, "timeout", "agent_prompt_stalled"))
    throw new DispatchError(submitted.stderr, partial);
  return submitted.code === 0;
}

export interface DispatchOptions {
  repo: string;
  branch: string;
  prompt: string;
  name?: string | undefined;
  base: string;
  timeout: number;
}

export async function dispatch(
  options: DispatchOptions,
  run: Runner = spawnRunner,
): Promise<DispatchResult> {
  if (!BRANCH_PATTERN.test(options.branch))
    throw new DispatchError(
      `branch ${JSON.stringify(options.branch)} must match ${BRANCH_PATTERN.source}`,
      null,
    );
  if (options.name != null && !AGENT_NAME_PATTERN.test(options.name))
    throw new DispatchError(
      `agent name ${JSON.stringify(options.name)} must match ${AGENT_NAME_PATTERN.source}`,
      null,
    );
  // A ref may hold ~, ^, and @{}, so only the leading dash that herdr's own
  // parser would read as a flag is out.
  if (options.base.startsWith("-") || options.base.trim() === "")
    throw new DispatchError(`base ${JSON.stringify(options.base)} must name a ref`, null);
  const promptBytes = Buffer.byteLength(options.prompt);
  if (promptBytes > MAX_PROMPT_BYTES)
    throw new DispatchError(
      `the prompt is ${promptBytes} bytes, over the ${MAX_PROMPT_BYTES} an argument carries. Point the agent at a file instead of pasting its contents.`,
      null,
    );

  // A name already bound would fail agent start, after the worktree exists. Read
  // the live names first so a collision is caught before anything is created.
  const listed = await requiredJson(run, ["herdr", "agent", "list"], AgentList, null);
  const taken = agentNames(listed);
  const wanted = options.name ?? deriveName(options.branch, taken);
  if (taken.has(wanted))
    throw new DispatchError(
      `agent name ${JSON.stringify(wanted)} is already bound to a live agent`,
      null,
    );

  // herdr refuses a linked worktree as the source of a new one, and this skill
  // is most often loaded from inside one. The porcelain listing puts the main
  // worktree first whatever the repository's git layout.
  const listing = await required(
    run,
    ["git", "-C", options.repo, "worktree", "list", "--porcelain"],
    null,
  );
  const root = listing.stdout
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  if (root == null || root === "")
    throw new DispatchError(`git named no worktree for ${options.repo}`, null);

  try {
    const remote = await baseRemote(run, root, options.base);
    if (remote != null)
      await required(run, ["git", "-C", root, "fetch", remote], null, {
        timeoutMs: FETCH_TIMEOUT_MS,
        // Unattended, a credential prompt would wait for input nobody is there
        // to give. The timeout covers an SSH agent that waits on a hardware key.
        env: { GIT_TERMINAL_PROMPT: "0" },
      });

    // herdr rejects an unknown base too, after paying for the worktree attempt.
    const verified = await run([
      "git",
      "-C",
      root,
      "rev-parse",
      "--verify",
      "--quiet",
      options.base,
    ]);
    if (verified.code !== 0)
      throw new DispatchError(
        `base ${JSON.stringify(options.base)} names no commit in ${root}`,
        null,
      );

    const created = await requiredJson(
      run,
      [
        "herdr",
        "worktree",
        "create",
        "--cwd",
        root,
        "--branch",
        options.branch,
        "--base",
        options.base,
        "--label",
        options.branch,
        "--no-focus",
      ],
      WorktreeCreated,
      null,
    );

    // Everything past here has a worktree behind it, so a failure carries the
    // record forward rather than leaving the checkout orphaned without a trace.
    const partial: DispatchRecord = {
      workspace: created.result.workspace.workspace_id,
      pane: created.result.root_pane.pane_id,
      agent: null,
      path: created.result.worktree.path,
      branch: options.branch,
      session: null,
      status: "unknown",
      prompted: false,
    };

    const { name, started } = await startNamed(run, options, partial, wanted);

    // A brand-new worktree draws Claude Code's trust dialog. The name binds
    // anyway, and agent prompt stays refused until the dialog settles.
    const ready = started.code === 0;
    if (fatal(started, "agent_not_ready")) throw new DispatchError(started.stderr, partial);
    partial.agent = name;

    if (ready) partial.prompted = await deliver(run, name, options, partial, started);

    const info = await requiredJson(run, ["herdr", "agent", "get", name], AgentInfo, partial);

    return {
      root,
      record: {
        ...partial,
        session: info.result.agent.agent_session?.value ?? null,
        status: info.result.agent.agent_status,
      },
    };
  } catch (error) {
    // Only this frame knows the checkout a partial record came from, and the
    // ledger records it against that repository.
    if (error instanceof DispatchError) error.root ??= root;
    throw error;
  }
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

if (import.meta.main) {
  const argv = cli({
    name: "dispatch",
    help: {
      description:
        "Create a worktree, start a Claude agent in its root pane, and hand it a prompt. The repository's own checkout is never moved.",
    },
    flags: {
      repo: { type: String, default: process.cwd(), description: "Repository to branch from" },
      branch: { type: String, description: "Branch to create for the dispatched agent (required)" },
      prompt: { type: String, description: "File holding the prompt; reads stdin when absent" },
      name: { type: String, description: "Agent name; derived from the branch when absent" },
      base: { type: String, default: "origin/main", description: "Ref the new branch starts from" },
      dataDir: {
        type: String,
        description: "Dispatch ledger directory; defaults to the plugin data dir",
      },
      timeout: {
        type: Number,
        default: 15_000,
        description: "Milliseconds to wait for the agent to start working",
      },
    },
  });

  if (argv.flags.branch == null || argv.flags.branch === "") {
    process.stderr.write("--branch is required\n");
    argv.showHelp();
    process.exit(2);
  }

  if (!Number.isFinite(argv.flags.timeout) || argv.flags.timeout <= 0) {
    process.stderr.write("--timeout must be a positive number of milliseconds\n");
    process.exit(2);
  }

  const prompt = await readPrompt(argv.flags.prompt);
  if (prompt.trim() === "") {
    process.stderr.write("the prompt is empty; pass --prompt <file> or pipe it on stdin\n");
    process.exit(2);
  }

  // The agent is already running and the caller needs its identifiers, so a
  // ledger failure warns rather than failing the dispatch.
  const writeLedger = (
    record: DispatchRecord,
    repo: string,
    outcome: "dispatched" | "orphaned",
  ) => {
    try {
      appendDispatch(
        {
          ts: new Date().toISOString(),
          task: taskSummary(prompt),
          repo,
          branch: record.branch,
          path: record.path,
          workspace: record.workspace,
          pane: record.pane,
          agent: record.agent,
          session: record.session,
          outcome,
        },
        resolveDataDir(argv.flags.dataDir),
      );
    } catch (error) {
      process.stderr.write(
        `warning: dispatch ledger not written: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };

  try {
    const { record, root } = await dispatch({
      repo: argv.flags.repo,
      branch: argv.flags.branch,
      prompt,
      name: argv.flags.name,
      base: argv.flags.base,
      timeout: argv.flags.timeout,
    });

    if (!record.prompted)
      process.stderr.write(
        `warning: herdr could not confirm ${record.agent ?? "the agent"} received the prompt. Read the pane with \`herdr agent read ${record.pane}\`: answer any dialog with \`herdr agent send-keys\` and submit the prompt yourself, or confirm the agent is already working on it.\n`,
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
      writeLedger(error.partial, error.root ?? argv.flags.repo, "orphaned");
    }
    process.exit(1);
  }
}
