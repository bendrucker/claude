import type { EngineInterface, On, PluginOptions } from "claude-code";
import { type BrowserCall, type Census, browserCalls, judge } from "./browser";
import {
  type Cap,
  type Machine,
  judge as judgeCaps,
  loadPerCore,
  parseCaps,
  plan as planCaps,
  pressureLevel,
  processes,
} from "./caps";
import { segments } from "./command";
import { type Level, type Thresholds, level, reminder } from "./pace";

const MOD = "load";
const MAIN = "main";

const ENDED = new Set(["completed", "failed", "killed"]);
const CONTINUING = new Set(["clear", "resume"]);

// SubagentStop closes an agent's sessions at once, but a background subagent
// stopped with TaskStop doesn't fire it, so its sessions are looked for on a
// timer while one is open.
const SWEEP_MS = 30_000;

// Pacing samples the machine at most this often, so most tool calls cost nothing.
const SAMPLE_MS = 15_000;

interface Config {
  caps: Cap[];
  invalid: string[];
  refuse: number;
  pace: Thresholds;
}

function configOf(options: PluginOptions): Config {
  const entries = options.caps;
  const number = (key: string) => {
    const value = options[key];
    return typeof value === "number" ? value : 0;
  };
  return {
    ...parseCaps(Array.isArray(entries) ? entries : []),
    refuse: number("refuse"),
    pace: { remind: number("remind"), warn: number("warn") },
  };
}

interface State {
  /** Session to the agent that launched it. */
  owners: Map<string, string>;
  pending: Set<string>;
  /** Pools of capped jobs allowed to start whose call has not returned. */
  starting: string[];
  sweep: { cancel: () => void } | undefined;
  sample: { at: number; machine: Machine } | undefined;
  /** Pacing level each agent was last told. */
  told: Map<string, Level>;
}

async function liveSessions($: EngineInterface): Promise<Set<string>> {
  const { exitCode, stdout, stderr } = await $.process.run(
    ["agent-browser", "session", "list", "--json"],
    { timeoutMs: 5000 },
  );
  if (exitCode !== 0) throw new Error(`agent-browser session list exited ${exitCode}: ${stderr}`);
  const parsed: unknown = JSON.parse(stdout);
  const sessions =
    typeof parsed === "object" &&
    parsed !== null &&
    "data" in parsed &&
    typeof parsed.data === "object" &&
    parsed.data !== null &&
    "sessions" in parsed.data
      ? parsed.data.sessions
      : undefined;
  if (!Array.isArray(sessions)) throw new Error(`unexpected session list: ${stdout}`);
  return new Set(sessions.filter((s) => typeof s === "string"));
}

async function machine($: EngineInterface, caps: readonly Cap[]): Promise<Machine> {
  const [ps, sysctl] = await Promise.all([
    $.process.run(["ps", "-axo", "pid=,ppid=,command="], { timeoutMs: 5000 }),
    // The pressure level is hidden from `sysctl -a` but reads by name without root.
    $.process.run(
      ["sysctl", "-n", "vm.loadavg", "hw.ncpu", "kern.memorystatus_vm_pressure_level"],
      { timeoutMs: 5000 },
    ),
  ]);
  return {
    ...processes(caps, ps.stdout),
    loadPerCore: loadPerCore(sysctl.stdout),
    pressure: pressureLevel(sysctl.stdout),
  };
}

async function sampled($: EngineInterface, state: State, config: Config): Promise<Machine> {
  const now = await $.clock.now();
  if (state.sample === undefined || now - state.sample.at >= SAMPLE_MS) {
    state.sample = { at: now, machine: await machine($, config.caps) };
  }
  return state.sample.machine;
}

/** Guidance for an agent whose machine got busier since it was last told. */
async function pace(
  $: EngineInterface,
  state: State,
  config: Config,
  owner: string,
): Promise<string | undefined> {
  if (config.pace.remind <= 0) return undefined;
  const now = await sampled($, state, config);
  const grade = level(now, config.pace);
  const told = state.told.get(owner) ?? 0;
  // A calmer machine re-arms the reminder for when load climbs again.
  if (grade < told) state.told.set(owner, grade);
  if (grade <= told) return undefined;
  state.told.set(owner, grade);
  void $.modEvents.emit({
    mod: MOD,
    event: "pace",
    detail: {
      level: grade,
      loadPerCore: now.loadPerCore ?? null,
      pressure: now.pressure ?? null,
      sessions: now.sessions,
      running: now.running,
      agent: owner === MAIN ? null : owner,
    },
  });
  return reminder(now, grade);
}

function census(state: State, owner: string, isSubagent: boolean, live: Set<string>): Census {
  const mine = new Set<string>();
  for (const [session, by] of state.owners) {
    if (by === owner && (live.has(session) || state.pending.has(session))) mine.add(session);
  }
  // The main loop may close every session.
  const others = isSubagent ? new Set([...live].filter((s) => !mine.has(s))) : new Set<string>();
  return { live, pending: state.pending, mine, others };
}

async function close(
  $: EngineInterface,
  state: State,
  session: string,
  trigger: string,
  timeoutMs: number,
): Promise<void> {
  const owner = state.owners.get(session);
  const agent = owner === MAIN ? null : (owner ?? null);
  state.owners.delete(session);
  const { exitCode, stderr } = await $.process
    .run(["agent-browser", "--session", session, "close"], { timeoutMs })
    .catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }));
  void $.modEvents.emit({
    mod: MOD,
    event: "browser.close",
    ok: exitCode === 0,
    detail: { session, agent, trigger, exitCode, stderr: stderr.trim() },
  });
}

async function sweep($: EngineInterface, state: State): Promise<void> {
  const owned = [...state.owners].filter(([, owner]) => owner !== MAIN);
  if (owned.length === 0) {
    state.sweep?.cancel();
    state.sweep = undefined;
    return;
  }
  state.sweep ??= $.clock.every(SWEEP_MS, () => {
    sweep($, state).catch((error: unknown) => {
      failed($, "sweep", "threw", String(error));
    });
  });
  const agents = await $.agent.list();
  // A workflow's agents are absent from the list, so only a listed agent that
  // ended has its sessions closed. The rest wait for the idle timeout.
  const ended = new Set(agents.filter((a) => ENDED.has(a.status)).map((a) => a.id));
  await Promise.all(
    owned
      .filter(([session, owner]) => ended.has(owner) && !state.pending.has(session))
      .map(([session]) => close($, state, session, "agent-end", 5000)),
  );
}

function record(state: State, calls: BrowserCall[], owner: string, live: Set<string>): string[] {
  const launched: string[] = [];
  for (const call of calls) {
    if (call.effect !== "launch" || live.has(call.session) || state.owners.has(call.session)) {
      continue;
    }
    state.owners.set(call.session, owner);
    state.pending.add(call.session);
    launched.push(call.session);
  }
  return launched;
}

function forget(state: State, calls: BrowserCall[]): void {
  for (const call of calls) {
    if (call.effect === "close") state.owners.delete(call.session);
    if (call.effect === "close-all") state.owners.clear();
  }
}

function failed($: EngineInterface, hook: string, kind: string, message?: string): void {
  $.modEvents
    .emit({
      mod: MOD,
      event: "error",
      ok: false,
      detail: { hook, kind, message: message ?? null },
    })
    .catch(() => undefined);
}

export function register(on: On, options: PluginOptions): void {
  const config = configOf(options);
  const state: State = {
    owners: new Map(),
    pending: new Set(),
    starting: [],
    sweep: undefined,
    sample: undefined,
    told: new Map(),
  };

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({
      mod: MOD,
      event: "session.start",
      ...(config.invalid.length > 0 && { ok: false, detail: { invalidCaps: config.invalid } }),
    });
    return next(e);
  });

  // Runs after the tool, so the sample never delays the call itself.
  on("tool.call", async ($, e, next) => {
    const result = await next(e);
    if (result.deny !== undefined) return result;
    const text = await pace($, state, config, e.agentId ?? MAIN);
    return text === undefined ? result : { ...result, context: [...(result.context ?? []), text] };
  }).catch(($, e, next) => {
    failed($, "pace", next.error.kind, next.error.message);
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const parts = segments(e.command);
    const calls = browserCalls(parts);
    const plan = planCaps(config.caps, parts);
    if (calls.length === 0 && plan.pools.length === 0) return next(e);

    const owner = e.agentId ?? MAIN;
    const agent = e.agentId ?? null;
    let live = new Set<string>();
    if (calls.length > 0) {
      live = await liveSessions($);
      const verdict = judge(calls, census(state, owner, e.agentId !== undefined, live));
      if (verdict.deny !== undefined) {
        void $.modEvents.emit({
          mod: MOD,
          event: "browser.deny",
          detail: {
            reason: verdict.reason,
            sessions: calls.map((c) => c.session),
            live: live.size,
            agent,
          },
        });
        return { deny: verdict.deny };
      }
    }

    if (plan.pools.length > 0) {
      const probed = await machine($, config.caps);
      state.sample = { at: await $.clock.now(), machine: probed };
      const now = { ...probed, running: [...probed.running, ...state.starting] };
      const verdict = judgeCaps(config.caps, plan, now, config.refuse);
      void $.modEvents.emit({
        mod: MOD,
        event: verdict.deny === undefined ? "cap.start" : "cap.deny",
        detail: {
          reason: verdict.reason ?? null,
          pools: plan.pools,
          running: now.running,
          loadPerCore: now.loadPerCore ?? null,
          pressure: now.pressure ?? null,
          agent,
        },
      });
      if (verdict.deny !== undefined) return { deny: verdict.deny };
    }

    state.starting.push(...plan.pools);
    const launched = record(state, calls, owner, live);
    for (const session of launched) {
      void $.modEvents.emit({
        mod: MOD,
        event: "browser.launch",
        detail: { session, live: live.size, agent },
      });
    }
    try {
      return await next(e);
    } finally {
      for (const session of launched) state.pending.delete(session);
      for (const pool of plan.pools) state.starting.splice(state.starting.indexOf(pool), 1);
      forget(state, calls);
      if (launched.length > 0) await sweep($, state);
    }
    // Fails open: refusing on a broken probe would block every matching call.
  }).catch(($, e, next) => {
    failed($, "tool.call", next.error.kind, next.error.message);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    await sweep($, state);
    return next(e);
  }).catch(($, e, next) => {
    failed($, "turn.complete", next.error.kind, next.error.message);
    return next(e);
  });

  on("classic.SubagentStop", async ($, e, next) => {
    const sessions = [...state.owners]
      .filter(([session, owner]) => owner === e.agent_id && !state.pending.has(session))
      .map(([session]) => session);
    await Promise.all(sessions.map((s) => close($, state, s, "agent-stop", 5000)));
    if (sessions.length > 0) await sweep($, state);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("session.end", async ($, e, next) => {
    if (CONTINUING.has(e.reason)) return next(e);
    state.sweep?.cancel();
    state.sweep = undefined;
    // session.end shares 1.5s across hooks. The idle timeout catches stragglers.
    await Promise.all([...state.owners.keys()].map((s) => close($, state, s, "session-end", 1000)));
    return next(e);
  }).catch(($, e, next) => {
    failed($, "session.end", next.error.kind, next.error.message);
    return next(e);
  });
}
