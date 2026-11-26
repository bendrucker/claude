import { z } from "zod";
import { backgroundId, detachedEnv } from "./mux";
import { deriveName } from "./naming";
import { DispatchError, type DispatchOptions, type DispatchRecord } from "./record";
import { decode, requiredJson } from "./required";
import type { CommandResult, Pause, Runner } from "./runner";
import {
  classifyScreen,
  envelopeCode,
  readBackgroundStatus,
  readProgramStatus,
  type Status,
} from "./status";

const SPLIT_RIGHT_COLUMNS = 160;
const NAME_ATTEMPTS = 3;
// A new pane draws its prompt while a startup hook such as mise's still holds
// the foreground, and agent start refuses the pane as busy until it lets go.
const BUSY_PAUSE_MS = 1_000;
const POLL_MS = 1_000;
const WORKTREE_LINE = /^dispatch worktree: (\S+)$/m;
const BRANCH_LINE = /^dispatch branch: (\S+)$/m;

export const RexCreated = z.object({ block_ids: z.array(z.string()).min(1) });

const WorkspaceCreated = z.object({
  result: z.object({ root_pane: z.object({ pane_id: z.string() }) }),
});

export const AgentList = z.object({
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

function fatal(result: CommandResult, ...tolerated: readonly string[]): boolean {
  if (result.code === 0) return false;
  const code = envelopeCode(result.stderr);
  return code == null || !tolerated.includes(code);
}

export function agentNames(listed: z.infer<typeof AgentList>): ReadonlySet<string> {
  return new Set(listed.result.agents.flatMap((agent) => (agent.name == null ? [] : [agent.name])));
}

// The `--` keeps a prompt that opens with a dash or a frontmatter rule from
// parsing as a flag.
export function claudeArgs(name: string, prompt: string, extra: readonly string[] = []): string[] {
  return ["--name", name, ...extra, "--", prompt];
}

export interface Context {
  run: Runner;
  pause: Pause;
  options: DispatchOptions;
  partial: DispatchRecord;
  path: string;
}

const BlockSize = z.object({ columns: z.number() });

// A block whose size cannot be read splits to the right, as Rex does by default.
async function splitDirection(run: Runner, block: string): Promise<"right" | "below"> {
  const result = await run(["rex", "block", "call", "-b", block, "size"]);
  if (result.code !== 0) return "right";
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // An older Rex without the size method prints prose.
    return "right";
  }
  const parsed = BlockSize.safeParse(json);
  if (!parsed.success) return "right";
  return parsed.data.columns >= SPLIT_RIGHT_COLUMNS ? "right" : "below";
}

export async function launchRex(ctx: Context): Promise<void> {
  const { options, partial } = ctx;
  const command = ["--json", "--", "claude", ...claudeArgs(partial.name, options.prompt)];
  const argv =
    options.split && options.rexBlock != null
      ? [
          "rex",
          "split",
          "-b",
          options.rexBlock,
          `--split=${await splitDirection(ctx.run, options.rexBlock)}`,
          "-c",
          ctx.path,
          "--label",
          partial.title,
          "--focus=false",
          ...command,
        ]
      : [
          "rex",
          "window",
          "new",
          "-s",
          options.rexSession ?? "",
          partial.title,
          "-c",
          ctx.path,
          "--focus=false",
          ...command,
        ];
  const created = await requiredJson(ctx.run, argv, RexCreated, partial);
  partial.target = created.block_ids[0] ?? null;
}

// A derived name can be bound by another dispatch between the list and this
// start, and herdr names that race. The worktree already exists by then, so
// the dispatch takes the next free name rather than leaving it without a
// session. The replacement can lose the same race, so the retry is bounded. A
// name the caller asked for has no substitute.
async function startNamed(
  ctx: Context,
  pane: string,
  name: string,
  attempt = 1,
  busy = Math.ceil(ctx.options.timeout / BUSY_PAUSE_MS),
): Promise<{ name: string; started: CommandResult }> {
  const { run, options, partial } = ctx;
  const started = await run([
    "herdr",
    "agent",
    "start",
    name,
    "--kind",
    "claude",
    "--pane",
    pane,
    "--",
    ...claudeArgs(name, options.prompt),
  ]);
  const code = envelopeCode(started.stderr);
  if (code === "agent_pane_busy" && busy > 1) {
    await ctx.pause(BUSY_PAUSE_MS);
    return startNamed(ctx, pane, name, attempt, busy - 1);
  }
  if (options.name != null || attempt >= NAME_ATTEMPTS || code !== "agent_name_taken")
    return { name, started };

  const live = agentNames(await requiredJson(run, ["herdr", "agent", "list"], AgentList, partial));
  return startNamed(ctx, pane, deriveName(options.branch, live), attempt + 1, busy);
}

export async function launchHerdr(ctx: Context): Promise<void> {
  const { run, partial } = ctx;
  const workspace = await requiredJson(
    run,
    ["herdr", "workspace", "create", "--cwd", ctx.path, "--label", partial.branch, "--no-focus"],
    WorkspaceCreated,
    partial,
  );
  const pane = workspace.result.root_pane.pane_id;
  partial.target = pane;
  const { name, started } = await startNamed(ctx, pane, partial.name);
  // A trust dialog holds the session before herdr sees it ready, which the
  // status poll then reports as blocked.
  if (fatal(started, "agent_not_ready")) throw new DispatchError(started.stderr, partial);
  partial.name = name;
}

export const BARE_COMMAND =
  "Run claude-dispatch as the whole Bash command, with no cd, env prefix, pipe, chain, or loop, so its sandbox.excludedCommands entry applies. Issue one Bash call per dispatch. If it already was the whole command, the deployed settings lack claude-dispatch:* in excludedCommands.";

// The sandbox denies the jobs directory every background session writes.
const JOBS_DENIED = /EPERM[\s\S]*\.claude\/jobs|\.claude\/jobs[\s\S]*EPERM/;

export async function launchBackground(ctx: Context): Promise<void> {
  const { partial } = ctx;
  const started = await ctx.run(
    ["claude", "--bg", ...claudeArgs(partial.name, ctx.options.prompt)],
    {
      cwd: ctx.path,
      env: detachedEnv(process.env),
    },
  );
  if (started.code !== 0) {
    const message =
      started.stderr.trim() === "" ? `claude --bg exited ${started.code}` : started.stderr;
    throw new DispatchError(
      JOBS_DENIED.test(message)
        ? `claude --bg cannot write ~/.claude/jobs under the sandbox. ${BARE_COMMAND}\n${message}`
        : message,
      partial,
    );
  }
  partial.target = backgroundId(started.stdout);
}

// A background session has no screen until it prints, so its state comes from
// `claude agents`. A sandboxed listing comes back empty, and the last attempt
// falls back to the logs.
async function pollBackground(ctx: Context, last: boolean): Promise<Status> {
  const { run, partial } = ctx;
  const listed = await run(["claude", "agents", "--json", "--all", "--cwd", ctx.path]);
  const reported =
    listed.code === 0 ? readBackgroundStatus(listed.stdout, partial.target, partial.name) : null;
  if (reported != null && reported.status !== "unknown") {
    if (reported.kind != null) partial.blockedKind = reported.kind;
    if (reported.message != null) partial.blockedMessage = reported.message;
    return reported.status;
  }
  if (!last) return "unknown";
  return pollScreen(run, partial, ["claude", "logs", partial.target ?? partial.name]);
}

export async function pollScreen(
  run: Runner,
  partial: DispatchRecord,
  argv: readonly string[],
): Promise<Status> {
  const captured = await run(argv);
  if (captured.code !== 0) return "unknown";
  partial.path ??= WORKTREE_LINE.exec(captured.stdout)?.[1] ?? null;
  partial.branch = BRANCH_LINE.exec(captured.stdout)?.[1] ?? partial.branch;
  return classifyScreen(captured.stdout);
}

async function pollHerdr(ctx: Context, name: string): Promise<Status> {
  const result = await ctx.run(["herdr", "agent", "get", name]);
  if (result.code !== 0) return "unknown";
  const { agent } = decode(AgentInfo, result, "herdr agent get", ctx.partial).result;
  ctx.partial.session = agent.agent_session?.value ?? ctx.partial.session;
  if (agent.agent_status === "working" || agent.agent_status === "done") return "working";
  return agent.agent_status === "blocked" ? "blocked" : "unknown";
}

// Claude Code reports its state to Rex, which outlasts any screen pattern. The
// screen still shows what comes before the first report: the trust dialog, or
// the remote launcher's failure.
export async function pollRex(
  run: Runner,
  partial: DispatchRecord,
  server: readonly string[],
  last: boolean,
): Promise<Status> {
  const block = partial.target ?? "";
  const called = await run([
    "rex",
    ...server,
    "block",
    "call",
    "-b",
    block,
    "program_status",
    "{}",
  ]);
  const reported = called.code === 0 ? readProgramStatus(called.stdout) : null;
  if (reported != null) {
    if (reported.kind != null) partial.blockedKind = reported.kind;
    if (reported.message != null) partial.blockedMessage = reported.message;
    return reported.status;
  }
  const screen = await pollScreen(run, partial, [
    "rex",
    ...server,
    "capture",
    "-b",
    block,
    "--trim",
  ]);
  return last || screen === "blocked" || screen === "failed" ? screen : "unknown";
}

export async function awaitStatus(
  poll: (last: boolean) => Promise<Status>,
  pause: Pause,
  timeout: number,
): Promise<Status> {
  const attempt = async (left: number): Promise<Status> => {
    const status = await poll(left <= 1);
    if (status !== "unknown" || left <= 1) return status;
    await pause(POLL_MS);
    return attempt(left - 1);
  };
  return attempt(Math.ceil(timeout / POLL_MS));
}

export function localPoll(ctx: Context): (last: boolean) => Promise<Status> {
  const { run, partial } = ctx;
  if (partial.mux === "herdr") return () => pollHerdr(ctx, partial.name);
  if (partial.mux === "bg") return (last) => pollBackground(ctx, last);
  return (last) => pollRex(run, partial, [], last);
}
