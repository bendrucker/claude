import type { EngineInterface, On } from "claude-code";
import { type BrowserCall, type Census, browserCalls, judge } from "./browser";
import { type Machine, judgeBuilds, loadPerCore, planBuilds, runningBuilds } from "./builds";
import { segments } from "./command";

const MOD = "load";
const MAIN = "main";

const ENDED = new Set(["completed", "failed", "killed"]);
const CONTINUING = new Set(["clear", "resume"]);

// A background subagent stopped with TaskStop ends with no event of its own, so
// its sessions are looked for on a timer while one is open.
const SWEEP_MS = 30_000;

interface State {
  /** Session to the agent that launched it. */
  owners: Map<string, string>;
  pending: Set<string>;
  /** Builds allowed to start whose call has not returned. */
  building: string[];
  sweep: { cancel: () => void } | undefined;
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

async function machine($: EngineInterface): Promise<Machine> {
  const [ps, sysctl] = await Promise.all([
    $.process.run(["ps", "-axo", "command="], { timeoutMs: 5000 }),
    $.process.run(["sysctl", "-n", "vm.loadavg", "hw.ncpu"], { timeoutMs: 5000 }),
  ]);
  return { running: runningBuilds(ps.stdout), loadPerCore: loadPerCore(sysctl.stdout) };
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

export function register(on: On): void {
  const state: State = { owners: new Map(), pending: new Set(), building: [], sweep: undefined };

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const parts = segments(e.command);
    const calls = browserCalls(parts);
    const plan = planBuilds(parts);
    if (calls.length === 0 && plan.kinds.length === 0) return next(e);

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

    if (plan.kinds.length > 0) {
      const probed = await machine($);
      const now = { ...probed, running: [...probed.running, ...state.building] };
      const verdict = judgeBuilds(plan, now);
      void $.modEvents.emit({
        mod: MOD,
        event: verdict.deny === undefined ? "build.start" : "build.deny",
        detail: {
          reason: verdict.reason ?? null,
          kinds: plan.kinds,
          running: now.running,
          loadPerCore: now.loadPerCore ?? null,
          agent,
        },
      });
      if (verdict.deny !== undefined) return { deny: verdict.deny };
    }

    state.building.push(...plan.kinds);
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
      for (const kind of plan.kinds) state.building.splice(state.building.indexOf(kind), 1);
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
