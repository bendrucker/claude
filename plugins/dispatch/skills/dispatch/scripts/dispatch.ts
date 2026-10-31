#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the dispatch ledger in the plugin data dir under ~/.claude/plugins
import { homedir } from "node:os";
import { join } from "node:path";
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
// A new pane draws its prompt while a startup hook such as mise's still holds
// the foreground, and agent start refuses the pane as busy until it lets go.
const BUSY_PAUSE_MS = 1_000;
const POLL_MS = 1_000;
const LOCK_PAUSE_MS = 250;
// A denied write shares the prefix, but only a lock someone holds exists already.
const CONFIG_LOCK_HELD = /could not lock config file .*: File exists/;
const SETTINGS_FILE = ".claude/settings.local.json";
// Only the bottom of the screen shows the live state, and the transcript above
// it can quote either phrase.
const SCREEN_TAIL_LINES = 20;
const DIALOG =
  /Do you trust the files in this folder\?|trust this folder|Do you want to proceed\?|Esc to cancel/i;
const BUSY_SPINNER = /esc to interrupt/i;
// A spinner glyph, a gerund ending in an ellipsis, then the elapsed timer.
const SPINNER_LINE = /^\s*[^\s\w❯⏺│─]\s\S+…\s\(\d+[hms]\b/m;
// A first turn can finish inside one poll interval, leaving its timing line.
const TURN_DONE = /^\s*✻ .*\bdone\b/m;
// An echoed prompt followed by a reply. The empty input box shows a bare `❯`.
const ANSWERED = /^❯ \S.*\n(?:.*\n)*?⏺ /m;
// `--exec` and its shell launcher print these, and `--keep-open` leaves them on screen.
const EXEC_FAILED = /^dispatch failed: /m;
const WORKTREE_LINE = /^dispatch worktree: (\S+)$/m;
// Linux caps one argv element at 128KB including its terminator.
const MAX_ARG_BYTES = 128 * 1024 - 1;
// rex passes words without a shell. This launcher's own shell expands $HOME.
const REMOTE_LAUNCHER = [
  'script="$HOME/.claude-repo/plugins/dispatch/skills/dispatch/scripts/dispatch.ts"',
  'command -v bun >/dev/null 2>&1 || { echo "dispatch failed: bun is not on PATH"; exit 1; }',
  '[ -f "$script" ] || { echo "dispatch failed: $script is not deployed"; exit 1; }',
  'exec bun "$script" "$@"',
].join("; ");

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  // A fetch over SSH waits on an agent that may be waiting on a hardware key,
  // which never returns unattended.
  timeoutMs?: number;
  // An undefined value removes the variable.
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export type Runner = (argv: readonly string[], options?: RunOptions) => Promise<CommandResult>;

export type Pause = (ms: number) => Promise<void>;

// The sandbox marker covers the whole invocation, so every subprocess takes an argv array.
export const spawnRunner: Runner = async (argv, options) => {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...options?.env }).filter(
          (entry): entry is [string, string] => entry[1] != null,
        ),
      ),
      cwd: options?.cwd ?? process.cwd(),
    });
  } catch (error) {
    // Spawning throws when the binary is missing, which would escape the
    // DispatchError contract and lose the partial record with it.
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 127, stdout: "", stderr: `${argv[0]}: ${reason}\n` };
  }
  const timer =
    options?.timeoutMs == null
      ? null
      : setTimeout(() => {
          proc.kill();
        }, options.timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
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

export const MUXES = ["rex", "herdr", "bg"] as const;
export type Mux = (typeof MUXES)[number];
export type Status = "working" | "blocked" | "failed" | "unknown";

export interface DispatchRecord {
  mux: Mux;
  // The Rex block or herdr pane running the session.
  target: string | null;
  host: string | null;
  name: string;
  // A remote worktree's path is known only once its screen shows it.
  path: string | null;
  branch: string;
  session: string | null;
  status: Status;
  settings: string[];
  submoduleError?: string;
  // What a blocked Claude Code reported through Rex's program status.
  blockedKind?: string;
  blockedMessage?: string;
}

export interface DispatchResult {
  record: DispatchRecord;
  root: string;
}

// A partial record means a worktree exists that nobody owns.
export class DispatchError extends Error {
  readonly partial: DispatchRecord | null;
  root: string | null = null;

  constructor(message: string, partial: DispatchRecord | null) {
    super(message);
    this.name = "DispatchError";
    this.partial = partial;
  }
}

const WorktreeList = z.object({
  items: z.array(
    z.object({
      branch: z.string().nullish(),
      worktree: z.object({ path: z.string() }).nullish(),
    }),
  ),
});

const RexCreated = z.object({ block_ids: z.array(z.string()).min(1) });

const ProgramStatus = z.object({
  records: z.array(
    z.object({
      id: z.string().nullish(),
      state: z.string(),
      effective_app: z.string().nullish(),
      kind: z.string().nullish(),
      msg: z.string().nullish(),
    }),
  ),
});

export interface ReportedStatus {
  status: Status;
  kind?: string;
  message?: string;
}

// The session's own record carries no id. Records with one track its tasks.
export function readProgramStatus(stdout: string): ReportedStatus | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    // An older Rex, or a block that is not a terminal, returns something else.
    return null;
  }
  const parsed = ProgramStatus.safeParse(json);
  if (!parsed.success) return null;
  const claude = parsed.data.records.filter((record) => record.effective_app === "claude-code");
  const record = claude.find((entry) => entry.id == null) ?? claude[0];
  if (record == null) return null;
  if (record.state === "working" || record.state === "done") return { status: "working" };
  if (record.state === "error") return { status: "failed" };
  if (record.state !== "blocked") return { status: "unknown" };
  const blocked: ReportedStatus = { status: "blocked" };
  if (record.kind != null) blocked.kind = record.kind;
  if (record.msg != null) blocked.message = record.msg;
  return blocked;
}

const WorkspaceCreated = z.object({
  result: z.object({ root_pane: z.object({ pane_id: z.string() }) }),
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

const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const SettingsObject = z.record(z.string(), z.unknown());
export type Settings = z.infer<typeof SettingsObject>;

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
    // This probes arbitrary stderr for an envelope, so non-JSON just means there is none.
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

export interface Sender {
  name: string;
  // The Rex block or herdr pane running the dispatching session.
  mux: { kind: "rex" | "herdr"; id: string } | null;
}

const SessionEntry = z.object({ name: z.string().min(1) });

function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir != null && dir !== "" ? dir : join(homedir(), ".claude");
}

// Claude Code registers each live session under its pid with the name that
// ListAgents and SendMessage address it by.
export async function readSender(
  env: Readonly<Record<string, string | undefined>>,
): Promise<Sender | null> {
  const pid = env.CLAUDE_PID;
  if (pid == null || !/^\d+$/.test(pid)) return null;
  const file = Bun.file(join(claudeConfigDir(env), "sessions", `${pid}.json`));
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    // A missing or unreadable entry leaves the prompt without a return address.
    return null;
  }
  const parsed = SessionEntry.safeParse(json);
  if (!parsed.success) return null;
  return { name: parsed.data.name, mux: senderMux(env) };
}

function senderMux(env: Readonly<Record<string, string | undefined>>): Sender["mux"] {
  const rex = env.REX_BLOCK;
  if (rex != null && rex !== "") return { kind: "rex", id: rex };
  const herdr = env.HERDR_PANE_ID;
  if (herdr != null && herdr !== "") return { kind: "herdr", id: herdr };
  return null;
}

export function withSender(prompt: string, sender: Sender | null): string {
  if (sender == null) return prompt;
  const where =
    sender.mux == null
      ? ""
      : ` in ${sender.mux.kind === "rex" ? "Rex block" : "herdr pane"} \`${sender.mux.id}\``;
  return `${prompt.trimEnd()}\n\n---\n\nThe Claude session \`${sender.name}\`${where} dispatched this task. Reach it with \`SendMessage\` to \`${sender.name}\`.\n`;
}

export function formatRecord(record: DispatchRecord): string {
  return JSON.stringify(record);
}

// The host multiplexer is the default, and bg never is. A nested pane inherits
// the outer multiplexer's variables, so the environment cannot say which is inner.
export function detectMux(env: Readonly<Record<string, string | undefined>>): Mux {
  const rex = env.REX_BLOCK != null && env.REX_BLOCK !== "";
  const herdr = env.HERDR_ENV === "1";
  if (rex && herdr)
    throw new Error(
      "this session runs under both Rex and herdr, nested; pass --mux rex or --mux herdr",
    );
  if (rex) return "rex";
  if (herdr) return "herdr";
  throw new Error("no multiplexer hosts this session; pass --mux rex, --mux herdr, or --mux bg");
}

// Variables the launching session set for itself would bind a background
// session to this one. Settings re-apply their own env in the new session.
export function detachedEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, undefined> {
  return Object.fromEntries(
    Object.keys(env)
      .filter((key) => /^CLAUDE(?:CODE$|_)/.test(key) && key !== "CLAUDE_CODE_OAUTH_TOKEN")
      .map((key) => [key, undefined]),
  );
}

// `claude --bg` prints the id `claude attach` takes, alone or inside a hint.
export function backgroundId(stdout: string): string | null {
  const hinted = /claude (?:attach|logs|stop) (\S+)/.exec(stdout)?.[1];
  if (hinted != null) return hinted;
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  const only = lines.length === 1 ? lines[0]?.trim() : undefined;
  return only != null && /^\S+$/.test(only) ? only : null;
}

export function classifyScreen(screen: string): Status {
  const tail = screen.split("\n").slice(-SCREEN_TAIL_LINES).join("\n");
  if (EXEC_FAILED.test(tail)) return "failed";
  if (DIALOG.test(tail)) return "blocked";
  if ([BUSY_SPINNER, SPINNER_LINE, TURN_DONE].some((pattern) => pattern.test(tail)))
    return "working";
  if (ANSWERED.test(screen)) return "working";
  return "unknown";
}

// Base64 keeps a prompt or settings file one opaque word on its way through rex.
export function encodeArg(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export function decodeArg(value: string, label: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error(`${label} is not base64`);
  return Buffer.from(value, "base64").toString("utf8");
}

function isObject(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// Objects merge key by key, and arrays gain only the entries they lack.
export function mergeSettings(base: Settings, patch: Settings): Settings {
  const merged: Settings = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    if (isObject(existing) && isObject(value)) merged[key] = mergeSettings(existing, value);
    else if (isList(existing) && isList(value)) {
      const seen = new Set(existing.map((entry) => JSON.stringify(entry)));
      merged[key] = [
        ...existing,
        ...value.filter((entry) => {
          const encoded = JSON.stringify(entry);
          if (seen.has(encoded)) return false;
          seen.add(encoded);
          return true;
        }),
      ];
    } else merged[key] = value;
  }
  return merged;
}

export function settingsKeys(settings: Settings, prefix = ""): string[] {
  return Object.entries(settings)
    .flatMap(([key, value]) =>
      isObject(value) ? settingsKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
    )
    .toSorted();
}

export function settingsPatch(allow: readonly string[], sandboxWrite: readonly string[]): Settings {
  const patch: Settings = {};
  if (allow.length > 0) patch.permissions = { allow: [...allow] };
  if (sandboxWrite.length > 0) patch.sandbox = { filesystem: { allowWrite: [...sandboxWrite] } };
  return patch;
}

export function parseSettings(text: string, label: string): Settings {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${label} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parsed = SettingsObject.safeParse(json);
  if (!parsed.success) throw new Error(`${label} must hold a JSON object`);
  return parsed.data;
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
function baseRemote(remotes: ReadonlySet<string>, base: string): string | null {
  const candidate = base.split("/")[0];
  if (candidate == null || candidate === base) return null;
  return remotes.has(candidate) ? candidate : null;
}

function failureText(result: CommandResult, label: string): string {
  const stderr = result.stderr.trim();
  return stderr === "" ? `${label} exited ${result.code}` : stderr;
}

// Every worktree of a repository writes the one .git/config, and git fails at
// once rather than waiting when a sibling holds its lock.
function retryConfigLock(run: Runner, budgetMs: number, pause: Pause): Runner {
  const attempt = async (
    argv: readonly string[],
    options: RunOptions | undefined,
    waited: number,
  ): Promise<CommandResult> => {
    const result = await run(argv, options);
    if (result.code === 0 || !CONFIG_LOCK_HELD.test(result.stderr) || waited >= budgetMs)
      return result;
    await pause(LOCK_PAUSE_MS);
    return attempt(argv, options, waited + LOCK_PAUSE_MS);
  };
  return (argv, options) => attempt(argv, options, 0);
}

// GitHub over SSH signs with a key that may need a touch nobody is there to give, so
// fetch the same repository over HTTPS into the remote's own tracking refs.
export function fetchArgs(remote: string, url: string): string[] {
  const ssh = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?\/?$/.exec(url.trim());
  if (ssh?.[1] == null) return [remote];
  return [`https://github.com/${ssh[1]}.git`, `+refs/heads/*:refs/remotes/${remote}/*`];
}

// git worktree add leaves submodules empty, so a checkout whose tooling links
// into them comes up broken. The session can still repair it, so a failure is
// recorded rather than fatal.
async function initSubmodules(run: Runner, path: string): Promise<string | undefined> {
  if (!(await Bun.file(join(path, ".gitmodules")).exists())) return undefined;
  const result = await run(["git", "-C", path, "submodule", "update", "--init", "--recursive"], {
    timeoutMs: FETCH_TIMEOUT_MS,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  return result.code === 0 ? undefined : failureText(result, "git submodule update");
}

// A tracked settings file would put the grants in the session's next commit.
async function writeSettings(
  run: Runner,
  path: string,
  patch: Settings,
  partial: DispatchRecord,
): Promise<string[]> {
  const keys = settingsKeys(patch);
  if (keys.length === 0) return [];
  const ignored = await run(["git", "-C", path, "check-ignore", "--quiet", SETTINGS_FILE]);
  if (ignored.code === 1)
    throw new DispatchError(
      `${SETTINGS_FILE} is not git-ignored in ${path}, so the settings were not written`,
      partial,
    );
  if (ignored.code !== 0)
    throw new DispatchError(failureText(ignored, "git check-ignore"), partial);

  const file = Bun.file(join(path, SETTINGS_FILE));
  let existing: Settings = {};
  if (await file.exists()) {
    try {
      existing = parseSettings(await file.text(), join(path, SETTINGS_FILE));
    } catch (error) {
      throw new DispatchError(error instanceof Error ? error.message : String(error), partial);
    }
  }
  await Bun.write(file, `${JSON.stringify(mergeSettings(existing, patch), null, 2)}\n`);
  return keys;
}

function agentNames(listed: z.infer<typeof AgentList>): ReadonlySet<string> {
  return new Set(listed.result.agents.flatMap((agent) => (agent.name == null ? [] : [agent.name])));
}

// The `--` keeps a prompt that opens with a dash or a frontmatter rule from
// parsing as a flag.
function claudeArgs(name: string, prompt: string, extra: readonly string[] = []): string[] {
  return ["--name", name, ...extra, "--", prompt];
}

interface Context {
  run: Runner;
  pause: Pause;
  options: DispatchOptions;
  partial: DispatchRecord;
  path: string;
}

async function launchRex(ctx: Context): Promise<void> {
  const { options, partial } = ctx;
  const command = ["--json", "--", "claude", ...claudeArgs(partial.name, options.prompt)];
  const argv =
    options.split && options.rexBlock != null
      ? [
          "rex",
          "split",
          "-b",
          options.rexBlock,
          "--split=right",
          "-c",
          ctx.path,
          "--label",
          options.branch,
          "--focus=false",
          ...command,
        ]
      : [
          "rex",
          "window",
          "new",
          "-s",
          options.rexSession ?? "",
          options.branch,
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

async function launchHerdr(ctx: Context): Promise<void> {
  const { run, options, partial } = ctx;
  const workspace = await requiredJson(
    run,
    ["herdr", "workspace", "create", "--cwd", ctx.path, "--label", options.branch, "--no-focus"],
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

async function launchBackground(ctx: Context): Promise<void> {
  const { partial } = ctx;
  const started = await required(
    ctx.run,
    ["claude", "--bg", ...claudeArgs(partial.name, ctx.options.prompt)],
    partial,
    { cwd: ctx.path, env: detachedEnv(process.env) },
  );
  partial.target = backgroundId(started.stdout);
}

async function pollScreen(
  run: Runner,
  partial: DispatchRecord,
  argv: readonly string[],
): Promise<Status> {
  const captured = await run(argv);
  if (captured.code !== 0) return "unknown";
  partial.path ??= WORKTREE_LINE.exec(captured.stdout)?.[1] ?? null;
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
async function pollRex(
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

async function awaitStatus(
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

function localPoll(ctx: Context): (last: boolean) => Promise<Status> {
  const { run, partial } = ctx;
  if (partial.mux === "herdr") return () => pollHerdr(ctx, partial.name);
  if (partial.mux === "bg")
    return () => pollScreen(run, partial, ["claude", "logs", partial.target ?? partial.name]);
  return (last) => pollRex(run, partial, [], last);
}

export interface DispatchOptions {
  repo: string;
  branch: string;
  prompt: string;
  name?: string | undefined;
  base: string;
  timeout: number;
  mux: Mux;
  split?: boolean;
  rexSession?: string | undefined;
  rexBlock?: string | undefined;
  // A saved Rex host label. The launcher runs there with --exec.
  host?: string | undefined;
  settings?: Settings;
}

function validateCommon(
  options: WorktreeOptions & { prompt: string; name?: string | undefined },
): void {
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
  // A ref may hold ~, ^, and @{}, so only a leading dash that a parser would
  // read as a flag is out.
  if (options.base.startsWith("-") || options.base.trim() === "")
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
    "--base",
    options.base,
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
      options.branch,
      "-c",
      options.repo,
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

export type WorktreeOptions = Pick<
  DispatchOptions,
  "repo" | "branch" | "base" | "timeout" | "settings"
>;

interface Prepared {
  root: string;
  path: string;
  partial: DispatchRecord;
}

export async function dispatch(
  options: DispatchOptions,
  run: Runner = spawnRunner,
  pause: Pause = Bun.sleep,
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

  const { root, path, partial } = await prepareWorktree(options, wanted, options.mux, run, pause);
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

async function prepareWorktree(
  options: WorktreeOptions,
  name: string,
  mux: Mux,
  run: Runner,
  pause: Pause,
): Promise<Prepared> {
  // The porcelain listing puts the main worktree first whatever the
  // repository's git layout, and wt runs from there.
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
    const listedRemotes = await required(run, ["git", "-C", root, "remote"], null);
    const remotes = new Set(listedRemotes.stdout.split("\n").map((line) => line.trim()));
    const remote = baseRemote(remotes, options.base);
    if (remote != null) {
      const url = await required(run, ["git", "-C", root, "remote", "get-url", remote], null);
      const fetchOptions: RunOptions = {
        timeoutMs: FETCH_TIMEOUT_MS,
        env: { GIT_TERMINAL_PROMPT: "0" },
      };
      const args = fetchArgs(remote, url.stdout);
      // Without an HTTPS credential, a private repository is reachable only over the remote's own URL.
      const https =
        args.length > 1 ? await run(["git", "-C", root, "fetch", ...args], fetchOptions) : null;
      if (https?.code !== 0)
        await required(run, ["git", "-C", root, "fetch", remote], null, fetchOptions);
    }

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

    const locked = retryConfigLock(run, options.timeout, pause);
    await required(
      locked,
      [
        "wt",
        "-C",
        root,
        "switch",
        "--create",
        options.branch,
        "--base",
        options.base,
        "--no-cd",
        "--yes",
      ],
      null,
    );

    const worktrees = await requiredJson(
      run,
      ["wt", "-C", root, "list", "--format=json"],
      WorktreeList,
      null,
    );
    const path = worktrees.items.find((item) => item.branch === options.branch)?.worktree?.path;
    if (path == null)
      throw new DispatchError(`wt list shows no worktree for ${options.branch}`, null);

    // Everything past here has a worktree behind it, so a failure carries the
    // record forward rather than leaving the checkout orphaned without a trace.
    const partial: DispatchRecord = {
      mux,
      target: null,
      host: null,
      name,
      path,
      branch: options.branch,
      session: null,
      status: "unknown",
      settings: [],
    };

    const submoduleError = await initSubmodules(run, path);
    if (submoduleError != null) partial.submoduleError = submoduleError;
    partial.settings = await writeSettings(run, path, options.settings ?? {}, partial);
    return { root, path, partial };
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
): Promise<number> {
  validateCommon(options);
  const { path, partial } = await prepareWorktree(options, options.name, "rex", run, pause);
  process.stdout.write(`dispatch worktree: ${path}\n`);
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

if (import.meta.main) {
  const argv = cli({
    name: "dispatch",
    help: {
      description:
        "Create a worktree with wt, write its local Claude settings, and start `claude --name <name> <prompt>` in a new Rex tab or herdr workspace. The repository's own checkout is never moved.",
    },
    flags: {
      repo: { type: String, default: process.cwd(), description: "Repository to branch from" },
      branch: { type: String, description: "Branch to create for the session (required)" },
      prompt: { type: String, description: "File holding the prompt; reads stdin when absent" },
      name: { type: String, description: "Session name; derived from the branch when absent" },
      base: { type: String, default: "origin/main", description: "Ref the new branch starts from" },
      mux: {
        type: String,
        description:
          "rex, herdr, or bg (claude --bg); defaults to the multiplexer hosting this session",
      },
      session: {
        type: String,
        description: "Rex session ID or label for the new tab; defaults to REX_SESSION",
      },
      split: {
        type: Boolean,
        default: false,
        description: "Rex only: split the current block to the right instead of opening a tab",
      },
      allow: {
        type: [String],
        description: "Permission rule for permissions.allow (repeatable)",
      },
      sandboxWrite: {
        type: [String],
        description: "Path for sandbox.filesystem.allowWrite (repeatable)",
      },
      settingsJson: {
        type: String,
        description: "JSON file deep-merged into the worktree's .claude/settings.local.json",
      },
      host: {
        type: String,
        description:
          "Rex only: saved host label (`rex hosts list`) to run the session on; --repo is a path there",
      },
      exec: {
        type: Boolean,
        default: false,
        description:
          "Internal: the --host side. Prepare the worktree here and run claude in the foreground",
      },
      promptBase64: { type: String, description: "Internal: --exec prompt, base64" },
      settingsBase64: { type: String, description: "Internal: --exec settings JSON, base64" },
      dataDir: {
        type: String,
        description: "Dispatch ledger directory; defaults to the plugin data dir",
      },
      timeout: {
        type: Number,
        default: 30_000,
        description: "Milliseconds to wait for the session to start working",
      },
    },
  });

  // The caller's poll reads this screen, so every failure prints its marker.
  if (argv.flags.exec) {
    try {
      const { branch, name, promptBase64, settingsBase64 } = argv.flags;
      if (branch == null || branch === "") throw new Error("--branch is required");
      if (name == null || name === "") throw new Error("--name is required");
      if (promptBase64 == null) throw new Error("--prompt-base64 is required");
      const settings =
        settingsBase64 == null
          ? {}
          : parseSettings(decodeArg(settingsBase64, "--settings-base64"), "--settings-base64");
      process.exit(
        await execSession({
          repo: argv.flags.repo,
          branch,
          base: argv.flags.base,
          timeout: argv.flags.timeout,
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

  if (argv.flags.branch == null || argv.flags.branch === "") {
    process.stderr.write("--branch is required\n");
    argv.showHelp();
    process.exit(2);
  }

  if (!Number.isFinite(argv.flags.timeout) || argv.flags.timeout <= 0) {
    process.stderr.write("--timeout must be a positive number of milliseconds\n");
    process.exit(2);
  }

  const muxFlag = z.enum(MUXES).optional().safeParse(argv.flags.mux);
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
      argv.flags.settingsJson == null
        ? {}
        : parseSettings(await Bun.file(argv.flags.settingsJson).text(), argv.flags.settingsJson);
    settings = mergeSettings(extra, settingsPatch(argv.flags.allow, argv.flags.sandboxWrite));
  } catch (error) {
    process.stderr.write(
      `cannot read --settings-json: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  const prompt = await readPrompt(argv.flags.prompt);
  if (prompt.trim() === "") {
    process.stderr.write("the prompt is empty; pass --prompt <file> or pipe it on stdin\n");
    process.exit(2);
  }
  const sender = await readSender(process.env);

  // The session is already running and the caller needs its identifiers, so a
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
          mux: record.mux,
          target: record.target,
          host: record.host,
          name: record.name,
          session: record.session,
          sender: sender?.name ?? null,
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
      prompt: withSender(prompt, sender),
      name: argv.flags.name,
      base: argv.flags.base,
      timeout: argv.flags.timeout,
      mux,
      split: argv.flags.split,
      // REX_SESSION names a session on this machine, never the host's.
      rexSession:
        argv.flags.session ?? (argv.flags.host == null ? process.env.REX_SESSION : undefined),
      host: argv.flags.host,
      rexBlock: process.env.REX_BLOCK,
      settings,
    });

    if (record.submoduleError != null)
      process.stderr.write(
        `warning: submodules in ${record.path} were not initialized: ${record.submoduleError}\n`,
      );
    if (record.status !== "working")
      process.stderr.write(
        `warning: ${record.name} is ${record.status} after ${argv.flags.timeout}ms. Read its screen with \`${inspectHint(record)}\`.\n`,
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
