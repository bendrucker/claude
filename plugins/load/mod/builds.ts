import { type Segment, splitPrefix } from "./command";

// DuckDB gets its own pool: each process can claim gigabytes of memory and
// spill, so a few at once, not two of anything heavy, is the bound that matters.
export type Pool = "build" | "duckdb";

// Test runners match their main process only. Their workers' command lines name
// a path under the package (`vitest/dist/...`, `jest-worker`), which the
// lookahead after the name rules out.
const HEAVY: { kind: string; pool: Pool; pattern: RegExp }[] = [
  { kind: "ladle", pool: "build", pattern: /\bladle(?:\.js)? build\b/ },
  { kind: "vite", pool: "build", pattern: /\bvite(?:\.js)? build\b/ },
  {
    kind: "storybook",
    pool: "build",
    pattern: /\bstorybook(?:\.js)? build\b|\bbuild-storybook\b/,
  },
  {
    kind: "pytest-xdist",
    pool: "build",
    pattern: /\bpytest\b.* (?:-n ?|--numprocesses[ =])(?:auto|logical|\d+)\b/,
  },
  {
    kind: "vitest",
    pool: "build",
    pattern: /\bvitest(?:\.mjs)?(?=\s|$)(?!.*\s(?:--watch|watch|dev)\b)/,
  },
  {
    kind: "jest",
    pool: "build",
    pattern: /\bjest(?:\.js)?(?=\s|$)(?!.*\s(?:-i|--runInBand|--watch|--watchAll)\b)/,
  },
  { kind: "playwright", pool: "build", pattern: /\bplaywright(?:\/test\/cli\.js)? test\b/ },
  { kind: "duckdb", pool: "duckdb", pattern: /(?:^|\/)duckdb(?=\s|$)/ },
  {
    kind: "session-index",
    pool: "duckdb",
    pattern: /\/observability\/skills\/session\/scripts\/(?:refresh|import|query)\.ts\b/,
  },
];

const POOLS = new Map(HEAVY.map(({ kind, pool }) => [kind, pool]));

const PARALLEL_RUNNERS = /^(?:parallel|xargs .*-P ?(?:0|[2-9]|\d{2,})\b)/;

// Programs that start a build. Any other program only mentions one.
const LAUNCHERS =
  /^(?:npx|bunx|pnpx|pnpm|npm|yarn|bun|node|deno|uv|poetry|xargs|parallel|ladle|vite|storybook|build-storybook|pytest|python[\d.]*|vitest|jest|playwright|duckdb)$/;

const basename = (word: string | undefined) => word?.split("/").at(-1) ?? "";

function kindOf(line: string): string | undefined {
  return HEAVY.find(({ pattern }) => pattern.test(line))?.kind;
}

export interface BuildPlan {
  kinds: string[];
  isParallel: boolean;
}

const LOOPS = new Set(["for", "while", "until"]);

export function planBuilds(segments: Segment[]): BuildPlan {
  const kinds: string[] = [];
  let backgrounded = 0;
  let fanned = false;
  const isLoop = segments.some(({ words }) => LOOPS.has(words[0] ?? ""));
  for (const { words, isBackground } of segments) {
    const { argv } = splitPrefix(words);
    if (!LAUNCHERS.test(basename(argv[0]))) continue;
    const line = argv.join(" ");
    const kind = kindOf(line);
    if (kind === undefined) continue;
    kinds.push(kind);
    if (isBackground) backgrounded++;
    if (PARALLEL_RUNNERS.test(line)) fanned = true;
  }
  // A backgrounded build inside a loop starts one build per iteration at once.
  const isParallel = fanned || (backgrounded > 0 && (kinds.length > 1 || isLoop));
  return { kinds, isParallel };
}

// Wrappers (`npm exec`, `bun x`, the Bash tool's `zsh -c`) repeat a build's words.
const WORKER =
  /^(?:node|bun|deno|ladle|vite|storybook|build-storybook|pytest|python[\d.]*|duckdb)$/;
const RUNNER_STEPS = new Set(["x", "exec", "dlx", "run", "npx", "npx-cli.js", "npm-cli.js"]);

export function runningBuilds(ps: string): string[] {
  const kinds: string[] = [];
  for (const line of ps.split("\n")) {
    const [program, step] = line.trim().split(/\s+/).map(basename);
    if (!WORKER.test(program ?? "") || RUNNER_STEPS.has(step ?? "")) continue;
    const kind = kindOf(line);
    if (kind !== undefined) kinds.push(kind);
  }
  return kinds;
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

export const MAX_RUNNING: Record<Pool, number> = { build: 2, duckdb: 3 };
export const MAX_LOAD_PER_CORE = 3;
export const PRESSURE_WARN = 2;
export const PRESSURE_CRITICAL = 4;

export interface Machine {
  running: string[];
  loadPerCore: number | undefined;
  pressure: number | undefined;
}

export interface BuildVerdict {
  deny?: string;
  reason?: "parallel" | "pressure" | "running" | "load";
}

export function judgeBuilds(plan: BuildPlan, machine: Machine): BuildVerdict {
  if (plan.kinds.length === 0) return {};
  if (plan.isParallel) {
    return {
      reason: "parallel",
      deny: `This command starts ${plan.kinds.length} heavy jobs side by side (${plan.kinds.join(", ")}). Run them one at a time, each to completion, in separate commands or a sequential loop without \`&\`.`,
    };
  }
  const pressure = machine.pressure ?? 0;
  if (pressure >= PRESSURE_CRITICAL) {
    return {
      reason: "pressure",
      deny: `The machine is out of memory (critical memory pressure). Wait for running work to finish before starting a ${plan.kinds.join(", ")} job.`,
    };
  }
  for (const pool of new Set(plan.kinds.map((kind) => POOLS.get(kind)))) {
    if (pool === undefined) continue;
    const running = machine.running.filter((kind) => POOLS.get(kind) === pool);
    // Under memory pressure each pool shrinks to one job.
    const limit = pressure >= PRESSURE_WARN ? 1 : MAX_RUNNING[pool];
    if (running.length >= limit) {
      const why = pressure >= PRESSURE_WARN ? " while memory is under pressure" : "";
      return {
        reason: "running",
        deny: `${running.length} heavy ${pool} jobs are already running on this machine (${running.join(", ")}), the limit is ${limit}${why}. Wait for one to finish before starting this one.`,
      };
    }
  }
  if (machine.loadPerCore !== undefined && machine.loadPerCore > MAX_LOAD_PER_CORE) {
    return {
      reason: "load",
      deny: `The machine is saturated (load ${machine.loadPerCore.toFixed(1)}x its core count). Wait for running work to finish before starting a ${plan.kinds.join(", ")} job.`,
    };
  }
  return {};
}
