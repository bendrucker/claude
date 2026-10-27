#!/usr/bin/env bun

// hyperfine times each command's runs back to back, so drift over a
// comparison lands on one side. Running several short rounds in rotating
// order spreads it over both, and the report pools every round's samples
// per arm.

// concurrent climbs append to one comparison log, so writes need O_APPEND atomicity. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { availableParallelism, homedir, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cli, command } from "cleye";
import { table } from "table";
import { z } from "zod";

const Value = z.object({ value: z.number() });

const Export = z.object({
  schema_version: z.literal(2),
  results: z.array(
    z.object({
      command: z.string(),
      name: z.string().nullable(),
      measurements: z.array(
        z.object({
          time_wall_clock: Value,
          memory_peak_resident: Value.optional(),
          exit_code: z.number().nullable(),
        }),
      ),
    }),
  ),
});

export interface Arm {
  name: string;
  times: number[];
  memory: number[];
  failures: number;
  failedTimes?: number[];
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? Number.NaN)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

// Two-sided permutation p-value for the difference in medians: the share of
// random relabelings of the pooled samples whose difference is at least as
// extreme as the observed one.
export function permutationP(
  a: number[],
  b: number[],
  iterations = 10_000,
  random = Math.random,
): number {
  const observed = Math.abs(median(a) - median(b));
  const pooled = [...a, ...b];
  let extreme = 0;
  for (let i = 0; i < iterations; i++) {
    for (let j = pooled.length - 1; j > 0; j--) {
      const k = Math.floor(random() * (j + 1));
      [pooled[j], pooled[k]] = [pooled[k] ?? 0, pooled[j] ?? 0];
    }
    const diff = Math.abs(median(pooled.slice(0, a.length)) - median(pooled.slice(a.length)));
    if (diff >= observed) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

// Median absolute deviation over the median, a spread measure that one slow
// outlier run does not inflate.
export function relativeMad(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m))) / m;
}

export function pool(exports: z.infer<typeof Export>[]): Arm[] {
  const arms = new Map<string, Arm>();
  for (const file of exports) {
    for (const result of file.results) {
      const name = result.name ?? result.command;
      const arm = arms.get(name) ?? { name, times: [], memory: [], failures: 0 };
      for (const m of result.measurements) {
        const time = m.time_wall_clock.value;
        if (m.exit_code !== 0) {
          arm.failures++;
          (arm.failedTimes ??= []).push(time);
          continue;
        }
        arm.times.push(time);
        if (m.memory_peak_resident !== undefined) arm.memory.push(m.memory_peak_resident.value);
      }
      arms.set(name, arm);
    }
  }
  return [...arms.values()];
}

export interface Row {
  arm: string;
  n: number;
  median: number;
  spread: number;
  change?: number;
  p?: number;
  significant: boolean;
  lowN: boolean;
  failures: number;
  memory?: number;
}

export type Metric = "wall" | "memory";

const defaultMetric: Metric = "wall";

const samples = (arm: Arm, metric: Metric) => (metric === "memory" ? arm.memory : arm.times);

export function compare(
  arms: Arm[],
  base: string,
  alpha: number,
  minEffect: number,
  random = Math.random,
  metric: Metric = "wall",
): Row[] {
  const baseArm = arms.find((a) => a.name === base);
  if (baseArm === undefined)
    throw new Error(`no arm named ${base}; arms: ${arms.map((a) => a.name).join(", ")}`);
  const baseSamples = samples(baseArm, metric);
  const baseMedian = median(baseSamples);
  return arms.map((arm) => {
    const values = samples(arm, metric);
    const row: Row = {
      arm: arm.name,
      n: values.length,
      median: median(values),
      spread: relativeMad(values),
      significant: false,
      lowN: values.length < 4 || baseSamples.length < 4,
      failures: arm.failures,
      ...(arm.memory.length > 0 && { memory: median(arm.memory) }),
    };
    if (arm === baseArm) return row;
    const change = row.median / baseMedian - 1;
    // Arms that each repeat one value differ deterministically, and the median
    // test, which counts tied relabelings as extreme, would never star them.
    const constant = new Set(baseSamples).size === 1 && new Set(values).size === 1;
    const p = constant ? 0 : permutationP(baseSamples, values, 10_000, random);
    const significant = !row.lowN && p < alpha && Math.abs(change) >= minEffect;
    return { ...row, change, p, significant };
  });
}

function formatSeconds(seconds: number): string {
  return seconds >= 1 ? `${seconds.toFixed(2)}s` : `${(seconds * 1000).toFixed(1)}ms`;
}

export function progress(arms: Arm[]): string {
  return arms
    .map(
      (a) =>
        `${a.name} ${a.times.length > 0 ? formatSeconds(median(a.times)) : "-"}${a.failures > 0 ? ` (${a.failures} failed${a.failedTimes ? ` at ${a.failedTimes.map(formatSeconds).join(", ")}` : ""})` : ""}`,
    )
    .join(", ");
}

function markdownRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

export function render(rows: Row[], markdown: boolean, metric: Metric = "wall"): string {
  const header = ["arm", "n", "median", "±MAD", "change", "p", "peak MB", "failed"];
  const body = rows.map((r) => [
    r.arm,
    `${r.n}${r.lowN ? "†" : ""}`,
    metric === "memory" ? `${(r.median / 1e6).toFixed(1)}MB` : formatSeconds(r.median),
    `${(r.spread * 100).toFixed(1)}%`,
    r.change === undefined
      ? "base"
      : `${r.change >= 0 ? "+" : ""}${(r.change * 100).toFixed(1)}%${r.significant ? "*" : ""}`,
    r.p === undefined ? "" : r.p.toFixed(3),
    r.memory === undefined ? "" : (r.memory / 1e6).toFixed(1),
    r.failures === 0 ? "" : String(r.failures),
  ]);
  if (!markdown) return table([header, ...body]);
  return [
    markdownRow(header),
    markdownRow(header.map((_, i) => (i === 0 ? "---" : "---:"))),
    ...body.map(markdownRow),
  ].join("\n");
}

const Meta = z.object({
  hypothesis: z.string(),
  started: z.string(),
  ncpu: z.number(),
  arms: z.array(z.object({ name: z.string(), command: z.string() })),
  rounds: z.array(
    z.object({ order: z.array(z.string()), loadBefore: z.number(), loadAfter: z.number() }),
  ),
});

export type Meta = z.infer<typeof Meta>;

const META = "meta.json";

// A round counts as loaded once the one-minute load average passes twice the
// core count, where queued work starts stretching wall time.
export function flagged(meta: Meta): number[] {
  return meta.rounds.flatMap((r, i) =>
    Math.max(r.loadBefore, r.loadAfter) > 2 * meta.ncpu ? [i + 1] : [],
  );
}

export function loadSummary(meta: Meta): string {
  const loaded = flagged(meta);
  const head = `hypothesis: ${meta.hypothesis}`;
  if (loaded.length === 0) return `${head}\nload: no round above 2×${meta.ncpu} cpus`;
  return `${head}\nload: ${loaded.length} of ${meta.rounds.length} rounds above 2×${meta.ncpu} cpus (${loaded.join(", ")}). Re-run an accept that rests on them`;
}

export function roundFile(index: number): string {
  return `round-${String(index).padStart(3, "0")}.json`;
}

/** Export files of the rounds `flagged` reports, in a `run` output directory. */
export function loadedRounds(dir: string, meta: Meta): string[] {
  return flagged(meta).map((round) => join(dir, roundFile(round - 1)));
}

export function logPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "performance", "comparisons.jsonl");
}

function logComparison(meta: Meta, out: string, planned: number): void {
  const path = logPath();
  mkdirSync(dirname(path), { recursive: true });
  const loads = meta.rounds.flatMap((r) => [r.loadBefore, r.loadAfter]);
  const entry = {
    ts: new Date().toISOString(),
    cwd: process.cwd(),
    dir: resolve(out),
    hypothesis: meta.hypothesis,
    arms: meta.arms.map((a) => a.name),
    planned,
    rounds: meta.rounds.length,
    flagged: flagged(meta),
    maxLoad: loads.length > 0 ? Math.max(...loads) : null,
    ncpu: meta.ncpu,
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

async function readMeta(paths: string[]): Promise<{ dir: string; meta: Meta }[]> {
  const dirs = paths.filter((p) => !p.endsWith(".json"));
  const read = await Promise.all(
    dirs.map(async (dir) => {
      const file = Bun.file(join(dir, META));
      return (await file.exists()) ? { dir, meta: Meta.parse(await file.json()) } : null;
    }),
  );
  return read.filter((m) => m !== null);
}

async function readExports(
  paths: string[],
  skip = new Set<string>(),
): Promise<z.infer<typeof Export>[]> {
  const files = paths
    .flatMap((path) =>
      path.endsWith(".json")
        ? [path]
        : readdirSync(path)
            .filter((f) => f.endsWith(".json") && f !== META)
            .toSorted()
            .map((f) => join(path, f)),
    )
    .filter((file) => !skip.has(file));
  return Promise.all(
    files.map(async (file) => {
      try {
        return Export.parse(await Bun.file(file).json());
      } catch (error) {
        throw new Error(`${file} is not a hyperfine 2 export`, { cause: error });
      }
    }),
  );
}

const runCmd = command(
  {
    name: "run",
    parameters: ["<out>", "[hyperfine args...]"],
    flags: {
      arm: {
        type: [String],
        description: "name=command, once per arm (repeatable). The first arm is the base",
      },
      rounds: {
        type: Number,
        default: 6,
        description: "hyperfine invocations, rotating which arm runs first",
      },
      runs: { type: Number, default: 3, description: "Runs per arm per round" },
      warmup: { type: Number, default: 1, description: "Warmup runs per arm per round" },
      hypothesis: {
        type: String,
        description:
          "The prediction this comparison tests: the profile entry, the metric, and the expected move. 'A/A' for a noise floor",
      },
    },
    help: {
      description:
        "Run interleaved hyperfine rounds into <out>. Arguments after -- go to every hyperfine call",
    },
  },
  async (argv) => {
    const arms = argv.flags.arm.map((spec) => {
      const eq = spec.indexOf("=");
      if (eq < 1) throw new Error(`--arm expects name=command, got ${spec}`);
      return { name: spec.slice(0, eq), command: spec.slice(eq + 1) };
    });
    if (arms.length < 2) throw new Error("give at least two --arm flags");
    const hypothesis = argv.flags.hypothesis?.trim() ?? "";
    if (hypothesis === "")
      throw new Error(
        "give --hypothesis before measuring: the profile entry, the metric, and the expected move, or 'A/A' for a noise floor",
      );
    if (Bun.which("hyperfine") === null) throw new Error("hyperfine not found on PATH");
    mkdirSync(argv._.out, { recursive: true });
    if (readdirSync(argv._.out).some((f) => f.endsWith(".json")))
      throw new Error(`${argv._.out} already holds exports; report would pool them with this run`);
    const ncpu = availableParallelism();
    const meta: Meta = { hypothesis, started: new Date().toISOString(), ncpu, arms, rounds: [] };
    const metaPath = join(argv._.out, META);
    await Bun.write(metaPath, JSON.stringify(meta, null, 2));
    try {
      await runRounds(argv, arms, meta, metaPath);
    } finally {
      logComparison(meta, argv._.out, argv.flags.rounds);
    }
    console.error(
      `results in ${argv._.out}; next: compare.ts report ${argv._.out} --base ${arms[0]?.name}`,
    );
  },
);

async function runRounds(
  argv: {
    _: { out: string; hyperfineArgs: string[] };
    flags: { rounds: number; runs: number; warmup: number };
  },
  arms: { name: string; command: string }[],
  meta: Meta,
  metaPath: string,
): Promise<void> {
  for (let round = 0; round < argv.flags.rounds; round++) {
    const shift = round % arms.length;
    const ordered = [...arms.slice(shift), ...arms.slice(0, shift)];
    const out = join(argv._.out, roundFile(round));
    const args = [
      "hyperfine",
      "--runs",
      String(argv.flags.runs),
      "--warmup",
      String(argv.flags.warmup),
      "--export-json",
      out,
      ...argv._.hyperfineArgs,
      ...ordered.flatMap((a) => ["-n", a.name, a.command]),
    ];
    console.error(
      `round ${round + 1}/${argv.flags.rounds}: ${ordered.map((a) => a.name).join(", ")}`,
    );
    const loadBefore = loadavg()[0] ?? 0;
    const proc = Bun.spawnSync(args, { stdio: ["inherit", "ignore", "inherit"] });
    const loadAfter = loadavg()[0] ?? 0;
    meta.rounds.push({ order: ordered.map((a) => a.name), loadBefore, loadAfter });
    // oxlint-disable-next-line no-await-in-loop -- rounds run one after another, and each records its load before the next starts.
    await Bun.write(metaPath, JSON.stringify(meta, null, 2));
    if (proc.exitCode !== 0)
      throw new Error(
        `hyperfine exited ${proc.exitCode} in round ${round + 1}, which it does when a run exits nonzero. Pass -i after -- to record the failed run instead`,
      );
    // oxlint-disable-next-line no-await-in-loop -- rounds run one after another, and each reports before the next starts.
    const pooled = pool([Export.parse(await Bun.file(out).json())]);
    const loaded = Math.max(loadBefore, loadAfter) > 2 * meta.ncpu ? " ⚠" : "";
    console.error(
      `  ${progress(pooled)}  load ${loadBefore.toFixed(0)}→${loadAfter.toFixed(0)} /${meta.ncpu}cpu${loaded}`,
    );
    const failed = pooled.filter((a) => a.failures > 0).map((a) => a.name);
    if (failed.length > 0)
      throw new Error(
        `${failed.join(", ")} failed in round ${round + 1}. Run each once with its output visible to find the cause before measuring`,
      );
  }
}

const reportCmd = command(
  {
    name: "report",
    parameters: ["<exports...>"],
    flags: {
      base: {
        type: String,
        description: "Arm every other arm is compared against. Default: the first arm seen",
      },
      alpha: {
        type: Number,
        default: 0.1,
        description: "Permutation p below which a change can be starred",
      },
      minEffect: {
        type: Number,
        default: 0.03,
        description: "Smallest relative change that can be starred",
      },
      markdown: { type: Boolean, description: "Print a markdown table for the notes file" },
      metric: {
        type: (value: string): Metric => {
          if (value !== "wall" && value !== "memory") throw new Error("--metric is wall or memory");
          return value;
        },
        default: defaultMetric,
        description: "Compare wall time, or each run's peak resident memory",
      },
    },
    help: {
      description:
        "Pool hyperfine --export-json files (or directories of them) per arm and compare against a base",
    },
  },
  async (argv) => {
    const arms = pool(await readExports(argv._.exports));
    const base = argv.flags.base ?? arms[0]?.name;
    if (base === undefined) throw new Error("no results found");
    const metas = await readMeta(argv._.exports);
    for (const { meta } of metas) console.log(`${loadSummary(meta)}\n`);
    const report = (pooled: Arm[]) =>
      render(
        compare(
          pooled,
          base,
          argv.flags.alpha,
          argv.flags.minEffect,
          Math.random,
          argv.flags.metric,
        ),
        argv.flags.markdown === true,
        argv.flags.metric,
      );
    console.log(report(arms));
    const loaded = metas.flatMap(({ dir, meta }) => loadedRounds(dir, meta));
    if (loaded.length > 0) {
      const rest = pool(await readExports(argv._.exports, new Set(loaded)));
      const left = rest.some((a) => a.name === base) ? report(rest) : "every round was loaded";
      console.log(`\nwithout the loaded rounds:\n${left}`);
    }
    console.log(
      `* p < ${argv.flags.alpha} and |change| ≥ ${argv.flags.minEffect * 100}%. † fewer than 4 runs a side, too few to star.`,
    );
  },
);

if (import.meta.main) {
  void cli({ name: "compare", commands: [runCmd, reportCmd] }, (argv) => {
    argv.showHelp();
  });
}
