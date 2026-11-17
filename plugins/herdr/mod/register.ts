import type { AgentInfo, EngineInterface, On, SessionContextUsage } from "claude-code";

const MOD = "herdr";
const SOURCE = "bendrucker:herdr";

// A /clear or /resume ends the conversation, not the process, and no
// session.start follows it.
const CONTINUING = new Set(["clear", "resume"]);

const ACTIVE = new Set(["pending", "running", "waiting", "idle"]);

// Subagent and teammate events trigger a refresh, and while an agent is counted
// the counts are also re-read on a timer in case one of those events is missed.
const POLL_MS = 10_000;

// session.end shares 1.5 seconds across every hook.
const END_TIMEOUT_MS = 1000;

// A herdr that cannot start (missing binary, hung past the timeout) would
// otherwise be retried on every event and poll for the rest of the session.
const SUSPEND_AFTER = 3;

// herdr strips control bytes out of reported token values, which drops a
// pre-colored glyph's escape. The color is therefore the token's name, styled
// per name by the sidebar config. One name holds the glyph at a time.
const DIAL_TOKENS = {
  green: "ctx_low",
  yellow: "ctx_mid",
  redBright: "ctx_high",
  red: "ctx_crit",
} as const;

type DialColor = keyof typeof DIAL_TOKENS;

const CONTEXT_TOKENS = Object.values(DIAL_TOKENS);

const TITLE_TOKEN = "title";

// Claude Code appends a title record on every rename. The live title sits near
// the end of the transcript.
const TITLE_TAIL_BYTES = 262_144;

const DIAL_BASE = 0xf0a9e;

// The Claude mark herdr's sidebar shows in place of its own agent glyph.
const BRAND_GLYPH = String.fromCodePoint(0xec82);

// herdr holds pane metadata in memory, and the nightly dotfiles-upgrade
// restarts it, which drops every token and the brand. Re-sending on a timer
// restores them without waiting on the dial to move, which can take hours.
const REASSERT_MS = 3_600_000;

type Tokens = Record<string, string>;

interface Pane {
  bin: string;
  id: string;
}

interface Beacon {
  pane: Pane | undefined;
  reported: Tokens;
  dial: Tokens;
  title: string;
  isBrandDue: boolean;
  reassert: { cancel: () => void } | undefined;
  inFlight: Promise<void> | undefined;
  requests: number;
  seq: number;
  spawnFailures: number;
  poll: { cancel: () => void } | undefined;
}

function count(agents: AgentInfo[], glyph: string, keep: (agent: AgentInfo) => boolean): string {
  const n = agents.filter(keep).length;
  return n === 0 ? "" : `${glyph}${n}`;
}

export function tokensOf(agents: AgentInfo[], branch: string): Tokens {
  const active = agents.filter((agent) => ACTIVE.has(agent.status));
  return {
    subagents: count(active, "↳", (agent) => agent.teammateId === undefined),
    teammates: count(active, "⇄", (agent) => agent.teammateId !== undefined),
    agents_waiting: count(active, "?", (agent) => agent.status === "waiting"),
    agents_idle: count(active, "·", (agent) => agent.status === "idle"),
    branch,
  };
}

const TOKEN_NAMES = [...Object.keys(tokensOf([], "")), ...CONTEXT_TOKENS, TITLE_TOKEN];

const noDial = (): Tokens => Object.fromEntries(CONTEXT_TOKENS.map((name) => [name, ""]));

function dialColor(pct: number, exceeds: boolean): DialColor {
  let color: DialColor;
  if (pct < 40) color = "green";
  else if (pct < 65) color = "yellow";
  else if (pct < 80) color = "redBright";
  else color = "red";

  if (exceeds) {
    if (color === "green") color = "yellow";
    else if (color === "yellow" && pct >= 45) color = "red";
  }
  return color;
}

function dialIndex(pct: number): number {
  return Math.min(7, Math.floor((pct * 7) / 100));
}

function dialGlyph(index: number): string {
  return String.fromCodePoint(DIAL_BASE + index);
}

// `tokens` is what the last response was answered over. The 200k test resets
// with the percent when a compaction shrinks the context.
export function dialOf(context: Pick<SessionContextUsage, "tokens" | "percent">): Tokens {
  const dial = noDial();
  if (context.percent === undefined) return dial;
  const pct = Math.round(context.percent);
  const color = dialColor(pct, (context.tokens ?? 0) > 200_000);
  dial[DIAL_TOKENS[color]] = dialGlyph(dialIndex(pct));
  return dial;
}

interface TitleRecord {
  type: string;
  aiTitle?: string;
  customTitle?: string;
}

function isTitleRecord(value: unknown): value is TitleRecord {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || typeof value.type !== "string") return false;
  if ("aiTitle" in value && typeof value.aiTitle !== "string") return false;
  return !("customTitle" in value) || typeof value.customTitle === "string";
}

// Claude Code names a session by appending a record to its transcript and
// appends another on every rename. `/title` writes `custom-title` where the
// model's own naming writes `ai-title`.
function recordTitle(line: string): string | undefined {
  // Nearly every line is a turn. The raw test keeps the scan off JSON.parse.
  if (!line.includes("-title")) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch (error) {
    // A truncated or half-written line is expected and names nothing.
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  if (!isTitleRecord(record)) return undefined;
  if (record.type === "ai-title") return record.aiTitle;
  if (record.type === "custom-title") return record.customTitle;
  return undefined;
}

// A tail starts mid-line, but a truncated record never parses as an object, so
// the partial first line drops out without being singled out.
export function latestTitle(chunk: string): string | undefined {
  let title: string | undefined;
  for (const line of chunk.split("\n")) {
    // herdr strips control bytes, which would glue the words of a multi-line
    // title together, so whitespace is flattened here.
    const found = recordTitle(line)?.replaceAll(/\s+/gu, " ").trim();
    if (found !== undefined && found !== "") title = found;
  }
  return title;
}

// herdr drops a report whose seq is not above the last one, so the seq is taken
// before any await and a slow report cannot land over a newer one.
async function herdr(
  $: EngineInterface,
  beacon: Beacon,
  pane: Pane,
  args: string[],
  timeoutMs = 3000,
): Promise<boolean> {
  beacon.seq += 1;
  const argv = [
    pane.bin,
    "pane",
    "report-metadata",
    pane.id,
    "--source",
    SOURCE,
    "--seq",
    String(beacon.seq),
    ...args,
  ];
  const startedAt = await $.clock.now();
  const { exitCode, stderr } = await $.process
    .run(argv, { timeoutMs })
    .catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }));
  const ms = (await $.clock.now()) - startedAt;
  const ok = exitCode === 0;
  await $.modEvents.emit({
    mod: MOD,
    event: "herdr.call",
    ok,
    ms,
    detail: { op: "report-metadata", exitCode, stderr: stderr.trim() },
  });
  beacon.spawnFailures = exitCode === -1 ? beacon.spawnFailures + 1 : 0;
  if (beacon.spawnFailures === SUSPEND_AFTER) {
    beacon.pane = undefined;
    reassert($, beacon, false);
    poll($, beacon, false);
    void $.modEvents.emit({
      mod: MOD,
      event: "herdr.suspend",
      ok: false,
      detail: { suspended: true, spawnFailures: SUSPEND_AFTER },
    });
  }
  return ok;
}

async function branchOf($: EngineInterface): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(["git", "branch", "--show-current"], {
      timeoutMs: 1000,
    });
    return exitCode === 0 ? stdout.trim() : "";
  } catch {
    // A session outside git, or without git installed, has no branch to show.
    return "";
  }
}

async function publish($: EngineInterface, beacon: Beacon, tokens: Tokens): Promise<void> {
  const args: string[] = [];
  for (const [name, value] of Object.entries(tokens)) {
    if ((beacon.reported[name] ?? "") === value) continue;
    args.push(...(value === "" ? ["--clear-token", name] : ["--token", `${name}=${value}`]));
  }
  const pane = beacon.pane;
  if ((args.length === 0 && !beacon.isBrandDue) || pane === undefined) return;
  const brand = beacon.isBrandDue ? ["--display-agent", BRAND_GLYPH] : [];
  if (await herdr($, beacon, pane, [...brand, ...args])) {
    beacon.isBrandDue = false;
    beacon.reported = Object.fromEntries(
      Object.entries(tokens).filter(([, value]) => value !== ""),
    );
  }
}

async function drain($: EngineInterface, beacon: Beacon): Promise<void> {
  const seen = beacon.requests;
  try {
    const [agents, branch] = await Promise.all([$.agent.list(), branchOf($)]);
    const counted = tokensOf(agents, branch);
    await publish($, beacon, { ...counted, ...beacon.dial, [TITLE_TOKEN]: beacon.title });
    poll($, beacon, counted.subagents !== "" || counted.teammates !== "");
  } catch (error) {
    void $.modEvents.emit({
      mod: MOD,
      event: "refresh",
      ok: false,
      detail: { error: String(error) },
    });
  }
  if (beacon.requests !== seen && beacon.pane !== undefined) return drain($, beacon);
  beacon.inFlight = undefined;
}

function poll($: EngineInterface, beacon: Beacon, hasAgents: boolean): void {
  if (hasAgents && beacon.pane !== undefined) {
    beacon.poll ??= $.clock.every(POLL_MS, () => {
      refresh($, beacon);
    });
  } else {
    beacon.poll?.cancel();
    beacon.poll = undefined;
  }
}

function reassert($: EngineInterface, beacon: Beacon, isHosted: boolean): void {
  beacon.reassert?.cancel();
  beacon.reassert = isHosted
    ? $.clock.every(REASSERT_MS, () => {
        beacon.reported = {};
        beacon.isBrandDue = true;
        refresh($, beacon);
      })
    : undefined;
}

async function retitle($: EngineInterface, beacon: Beacon): Promise<void> {
  if (beacon.pane === undefined) return;
  try {
    const { transcriptPath } = await $.session.info();
    if (transcriptPath === "") return;
    const { exitCode, stdout } = await $.process.run(
      ["tail", "-c", String(TITLE_TAIL_BYTES), transcriptPath],
      { timeoutMs: 3000 },
    );
    if (exitCode !== 0) return;
    // A tail with no title record keeps the one already read, which carries a
    // name across a stretch of transcript that pushed every title out of the window.
    const title = latestTitle(stdout);
    if (title === undefined || title === beacon.title) return;
    beacon.title = title;
    void $.modEvents.emit({ mod: MOD, event: "title", detail: { title } });
    refresh($, beacon);
  } catch (error) {
    void $.modEvents.emit({
      mod: MOD,
      event: "title",
      ok: false,
      detail: { error: String(error) },
    });
  }
}

function redial($: EngineInterface, beacon: Beacon, context: SessionContextUsage): void {
  if (beacon.pane === undefined) return;
  const dial = dialOf(context);
  if (CONTEXT_TOKENS.every((name) => dial[name] === beacon.dial[name])) return;
  beacon.dial = dial;
  void $.modEvents.emit({
    mod: MOD,
    event: "dial",
    detail: {
      token: CONTEXT_TOKENS.find((name) => dial[name] !== "") ?? "",
      percent: context.percent ?? null,
    },
  });
  refresh($, beacon);
}

// Events arrive in bursts, so a refresh that lands mid-flight is counted and
// the running one reads again rather than racing it.
function refresh($: EngineInterface, beacon: Beacon): void {
  if (beacon.pane === undefined) return;
  beacon.requests += 1;
  beacon.inFlight ??= drain($, beacon);
}

/**
 * Publishes what herdr cannot see from outside the session as metadata tokens
 * on the pane hosting it: its subagents and teammates, how many of them wait or
 * sit idle, the branch, the context dial, and the session title, plus the brand
 * glyph. Lifecycle stays with herdr's own integration.
 */
export function register(on: On): void {
  const beacon: Beacon = {
    pane: undefined,
    reported: {},
    dial: noDial(),
    title: "",
    isBrandDue: false,
    reassert: undefined,
    inFlight: undefined,
    requests: 0,
    seq: 0,
    spawnFailures: 0,
    poll: undefined,
  };

  on("session.start", async ($, e, next) => {
    const [env, id, bin, now] = await Promise.all([
      $.env.get("HERDR_ENV"),
      $.env.get("HERDR_PANE_ID"),
      $.env.get("HERDR_BIN_PATH"),
      $.clock.now(),
    ]);
    // Clock-based, so a restarted session's seqs stay above the last one's.
    beacon.seq = Math.max(beacon.seq, now * 1000);
    beacon.reported = {};
    beacon.dial = noDial();
    beacon.title = "";
    beacon.isBrandDue = true;
    beacon.spawnFailures = 0;
    const isHosted = env === "1" && id !== undefined && id !== "" && e.isInteractive;
    beacon.pane = isHosted
      ? { bin: bin === undefined || bin === "" ? "herdr" : bin, id }
      : undefined;
    reassert($, beacon, isHosted);
    void $.modEvents.emit({ mod: MOD, event: "session.start", detail: { isHosted } });
    refresh($, beacon);
    void retitle($, beacon);
    return next(e);
  });

  on("session.measure", ($, e, next) => {
    if (e.changed.includes("context")) redial($, beacon, e.context);
    return next(e);
  });

  on("turn.start", ($, e, next) => {
    refresh($, beacon);
    return next(e);
  });

  on("turn.complete", ($, e, next) => {
    refresh($, beacon);
    void retitle($, beacon);
    return next(e);
  });

  on("classic.SubagentStart", ($, e, next) => {
    refresh($, beacon);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("classic.SubagentStop", ($, e, next) => {
    refresh($, beacon);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("classic.TeammateIdle", ($, e, next) => {
    refresh($, beacon);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("session.end", async ($, e, next) => {
    if (CONTINUING.has(e.reason)) {
      refresh($, beacon);
      return next(e);
    }
    // Not waiting on a refresh in flight: session.end has a short budget, and
    // the clear's higher seq makes herdr drop that refresh if it lands later.
    const pane = beacon.pane;
    beacon.pane = undefined;
    reassert($, beacon, false);
    poll($, beacon, false);
    if (pane !== undefined) {
      await herdr(
        $,
        beacon,
        pane,
        TOKEN_NAMES.flatMap((name) => ["--clear-token", name]),
        END_TIMEOUT_MS,
      );
    }
    return next(e);
  });
}
