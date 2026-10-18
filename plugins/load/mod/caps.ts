import { type Segment, splitPrefix } from "./command";

/** A pool of commands that may run at most `limit` at once on the machine. */
export interface Cap {
  pool: string;
  limit: number;
  pattern: RegExp;
}

const ENTRY = /^([\w-]+):(\d+):(.+)$/s;

/** Parses `pool:limit:regex` entries. Entries sharing a pool share its limit. */
export function parseCaps(entries: readonly string[]): { caps: Cap[]; invalid: string[] } {
  const caps: Cap[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const match = ENTRY.exec(entry);
    try {
      if (match === null) throw new Error("not pool:limit:regex");
      caps.push({ pool: match[1] ?? "", limit: Number(match[2]), pattern: new RegExp(match[3]) });
    } catch {
      invalid.push(entry);
    }
  }
  return { caps, invalid };
}

function poolOf(caps: readonly Cap[], line: string): Cap | undefined {
  return caps.find(({ pattern }) => pattern.test(line));
}

export interface Plan {
  pools: string[];
  isParallel: boolean;
}

const PARALLEL_RUNNERS = /^(?:parallel|xargs .*-P ?(?:0|[2-9]|\d{2,})\b)/;
const LOOPS = new Set(["for", "while", "until"]);

export function plan(caps: readonly Cap[], segments: Segment[]): Plan {
  const pools: string[] = [];
  let backgrounded = 0;
  let fanned = false;
  const isLoop = segments.some(({ words }) => LOOPS.has(words[0] ?? ""));
  for (const { words, isBackground } of segments) {
    // A quoted phrase (`git commit -m "fix vite build"`) mentions a command
    // rather than running it.
    const line = splitPrefix(words)
      .argv.filter((word) => !/\s/.test(word))
      .join(" ");
    const cap = poolOf(caps, line);
    if (cap === undefined) continue;
    pools.push(cap.pool);
    if (isBackground) backgrounded++;
    if (PARALLEL_RUNNERS.test(line)) fanned = true;
  }
  // A backgrounded job inside a loop starts one job per iteration at once.
  const isParallel = fanned || (backgrounded > 0 && (pools.length > 1 || isLoop));
  return { pools, isParallel };
}

export interface Processes {
  /** Pool of each running capped job, counted once per process tree. */
  running: string[];
  /** Claude Code processes, one per session. */
  sessions: number;
}

const basename = (word: string | undefined) => word?.split("/").at(-1) ?? "";

/** Reads `ps -axo pid=,ppid=,command=`. */
export function processes(caps: readonly Cap[], ps: string): Processes {
  const rows = ps
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, pid, ppid, command]) => ({ pid, ppid, command: command ?? "" }));
  const pools = new Map(rows.map(({ pid, command }) => [pid, poolOf(caps, command)?.pool]));
  const running: string[] = [];
  for (const { pid, ppid } of rows) {
    const pool = pools.get(pid);
    // Wrappers (`zsh -c`, `npm exec`) and workers repeat a job's words, so
    // only the top of a matching tree counts.
    if (pool !== undefined && pools.get(ppid) !== pool) running.push(pool);
  }
  const sessions = rows.filter(({ command }) => basename(command.split(" ")[0]) === "claude");
  return { running, sessions: sessions.length };
}

/** Parses `sysctl -n vm.loadavg hw.ncpu kern.memorystatus_vm_pressure_level`. */
export function loadPerCore(sysctl: string): number | undefined {
  const match = /\{\s*([\d.]+)[^}]*\}\s+(\d+)/.exec(sysctl);
  if (match === null) return undefined;
  const cores = Number(match[2]);
  return cores > 0 ? Number(match[1]) / cores : undefined;
}

/** macOS memory pressure: 1 normal, 2 warn, 4 critical. Missing on Linux. */
export function pressureLevel(sysctl: string): number | undefined {
  const line = sysctl.split("\n")[2]?.trim();
  return line !== undefined && /^\d+$/.test(line) ? Number(line) : undefined;
}

export const PRESSURE_WARN = 2;
export const PRESSURE_CRITICAL = 4;

export interface Machine extends Processes {
  loadPerCore: number | undefined;
  pressure: number | undefined;
}

export interface Verdict {
  deny?: string;
  reason?: "parallel" | "pressure" | "running" | "load";
}

export function judge(
  caps: readonly Cap[],
  { pools, isParallel }: Plan,
  machine: Machine,
  maxLoadPerCore: number,
): Verdict {
  if (pools.length === 0) return {};
  const jobs = pools.join(", ");
  if (isParallel) {
    return {
      reason: "parallel",
      deny: `This command starts ${pools.length} heavy jobs side by side (${jobs}). Run them one at a time, each to completion, in separate commands or a sequential loop without \`&\`.`,
    };
  }
  if ((machine.pressure ?? 0) >= PRESSURE_CRITICAL) {
    return {
      reason: "pressure",
      deny: `The machine is out of memory (critical memory pressure). Wait for running work to finish before starting a ${jobs} job.`,
    };
  }
  for (const pool of new Set(pools)) {
    const limit = caps.find((cap) => cap.pool === pool)?.limit ?? Infinity;
    const running = machine.running.filter((p) => p === pool).length;
    if (running >= limit) {
      return {
        reason: "running",
        deny: `${running} ${pool} jobs are already running on this machine, the limit is ${limit}. Wait for one to finish before starting this one.`,
      };
    }
  }
  const load = machine.loadPerCore;
  if (maxLoadPerCore > 0 && load !== undefined && load > maxLoadPerCore) {
    return {
      reason: "load",
      deny: `The machine is saturated (load ${load.toFixed(1)}x its core count). Wait for running work to finish before starting a ${jobs} job.`,
    };
  }
  return {};
}
