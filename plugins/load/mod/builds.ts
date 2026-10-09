import { type Segment, splitPrefix } from "./command";

const HEAVY: { kind: string; pattern: RegExp }[] = [
  { kind: "ladle", pattern: /\bladle(?:\.js)? build\b/ },
  { kind: "vite", pattern: /\bvite(?:\.js)? build\b/ },
  { kind: "storybook", pattern: /\bstorybook(?:\.js)? build\b|\bbuild-storybook\b/ },
  {
    kind: "pytest-xdist",
    pattern: /\bpytest\b.* (?:-n ?|--numprocesses[ =])(?:auto|logical|\d+)\b/,
  },
];

const PARALLEL_RUNNERS = /^(?:parallel|xargs .*-P ?(?:0|[2-9]|\d{2,})\b)/;

// Programs that start a build. Any other program only mentions one.
const LAUNCHERS =
  /^(?:npx|bunx|pnpx|pnpm|npm|yarn|bun|node|deno|uv|poetry|xargs|parallel|ladle|vite|storybook|build-storybook|pytest|python[\d.]*)$/;

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
const WORKER = /^(?:node|bun|deno|ladle|vite|storybook|build-storybook|pytest|python[\d.]*)$/;
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

/** Parses `sysctl -n vm.loadavg hw.ncpu`. */
export function loadPerCore(sysctl: string): number | undefined {
  const match = /\{\s*([\d.]+)[^}]*\}\s+(\d+)/.exec(sysctl);
  if (match === null) return undefined;
  const cores = Number(match[2]);
  return cores > 0 ? Number(match[1]) / cores : undefined;
}

export const MAX_BUILDS = 2;
export const MAX_LOAD_PER_CORE = 3;

export interface Machine {
  running: string[];
  loadPerCore: number | undefined;
}

export interface BuildVerdict {
  deny?: string;
  reason?: "parallel" | "running" | "load";
}

export function judgeBuilds(plan: BuildPlan, machine: Machine): BuildVerdict {
  if (plan.kinds.length === 0) return {};
  if (plan.isParallel) {
    return {
      reason: "parallel",
      deny: `This command starts ${plan.kinds.length} heavy builds side by side (${plan.kinds.join(", ")}). Run them one at a time, each to completion, in separate commands or a sequential loop without \`&\`.`,
    };
  }
  if (machine.running.length >= MAX_BUILDS) {
    return {
      reason: "running",
      deny: `${machine.running.length} heavy builds are already running on this machine (${machine.running.join(", ")}), the limit is ${MAX_BUILDS}. Wait for one to finish before starting this one.`,
    };
  }
  if (machine.loadPerCore !== undefined && machine.loadPerCore > MAX_LOAD_PER_CORE) {
    return {
      reason: "load",
      deny: `The machine is saturated (load ${machine.loadPerCore.toFixed(1)}x its core count). Wait for running work to finish before starting a ${plan.kinds.join(", ")} build.`,
    };
  }
  return {};
}
