import type { AgentInfo, EngineInterface, On } from "claude-code";

const MOD = "herdr";
const SOURCE = "bendrucker:herdr";

// A /clear or /resume ends the conversation, not the process, and no
// session.start follows it.
const CONTINUING = new Set(["clear", "resume"]);

const ACTIVE = new Set(["pending", "running", "waiting", "idle"]);

// While an agent is counted, a background subagent can finish or a teammate in
// its own pane go idle with no event here, so the counts are re-read on a timer.
const POLL_MS = 10_000;

type Tokens = Record<string, string>;

interface Pane {
  bin: string;
  id: string;
}

interface Beacon {
  pane: Pane | undefined;
  reported: Tokens;
  inFlight: Promise<void> | undefined;
  requests: number;
  seq: number;
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

const TOKEN_NAMES = Object.keys(tokensOf([], ""));

// herdr drops a report whose seq is not above the last one, so the seq is taken
// before any await and a slow report cannot land over a newer one.
async function herdr(
  $: EngineInterface,
  beacon: Beacon,
  pane: Pane,
  args: string[],
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
    .run(argv, { timeoutMs: 3000 })
    .catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }));
  const ms = (await $.clock.now()) - startedAt;
  const ok = exitCode === 0;
  void $.modEvents.emit({
    mod: MOD,
    event: "herdr.call",
    ok,
    ms,
    detail: { op: "report-metadata", exitCode, stderr: stderr.trim() },
  });
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
  if (args.length === 0 || pane === undefined) return;
  if (await herdr($, beacon, pane, args)) {
    beacon.reported = Object.fromEntries(
      Object.entries(tokens).filter(([, value]) => value !== ""),
    );
  }
}

async function drain($: EngineInterface, beacon: Beacon): Promise<void> {
  const seen = beacon.requests;
  try {
    const [agents, branch] = await Promise.all([$.agent.list(), branchOf($)]);
    const tokens = tokensOf(agents, branch);
    await publish($, beacon, tokens);
    poll($, beacon, tokens.subagents !== "" || tokens.teammates !== "");
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
 * sit idle, and the branch. Lifecycle stays with herdr's own integration.
 */
export function register(on: On): void {
  const beacon: Beacon = {
    pane: undefined,
    reported: {},
    inFlight: undefined,
    requests: 0,
    seq: 0,
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
    const isHosted = env === "1" && id !== undefined && id !== "" && e.isInteractive;
    beacon.pane = isHosted
      ? { bin: bin === undefined || bin === "" ? "herdr" : bin, id }
      : undefined;
    void $.modEvents.emit({ mod: MOD, event: "session.start", detail: { isHosted } });
    refresh($, beacon);
    return next(e);
  });

  on("turn.start", ($, e, next) => {
    refresh($, beacon);
    return next(e);
  });

  on("turn.complete", ($, e, next) => {
    refresh($, beacon);
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    if (CONTINUING.has(e.reason)) {
      refresh($, beacon);
      return next(e);
    }
    // Not waiting on a refresh in flight: session.end has a short budget, and
    // the clear's higher seq makes herdr drop that refresh if it lands later.
    const pane = beacon.pane;
    beacon.pane = undefined;
    poll($, beacon, false);
    if (pane !== undefined) {
      await herdr(
        $,
        beacon,
        pane,
        TOKEN_NAMES.flatMap((name) => ["--clear-token", name]),
      );
    }
    return next(e);
  });
}
