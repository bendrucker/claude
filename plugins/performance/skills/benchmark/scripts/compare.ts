#!/usr/bin/env bun

// hyperfine times each command's runs back to back, so drift over a
// comparison lands on one side. Running several short rounds in rotating
// order spreads it over both, and the report pools every round's samples
// per arm.

import { mkdirSync, readdirSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { cli, command } from "cleye";
import { table } from "table";
import { z } from "zod";

const Export = z.object({
  results: z.array(
    z.object({
      command: z.string(),
      times: z.array(z.number()),
      memory_usage_byte: z.array(z.number()).optional(),
      exit_codes: z.array(z.number().nullable()),
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
      const arm = arms.get(result.command) ?? {
        name: result.command,
        times: [],
        memory: [],
        failures: 0,
      };
      for (const [i, time] of result.times.entries()) {
        if (result.exit_codes[i] !== 0) {
          arm.failures++;
          (arm.failedTimes ??= []).push(time);
          continue;
        }
        arm.times.push(time);
        const memory = result.memory_usage_byte?.[i];
        if (memory !== undefined) arm.memory.push(memory);
      }
      arms.set(result.command, arm);
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

export function compare(
  arms: Arm[],
  base: string,
  alpha: number,
  minEffect: number,
  random = Math.random,
): Row[] {
  const baseArm = arms.find((a) => a.name === base);
  if (baseArm === undefined)
    throw new Error(`no arm named ${base}; arms: ${arms.map((a) => a.name).join(", ")}`);
  const baseMedian = median(baseArm.times);
  return arms.map((arm) => {
    const row: Row = {
      arm: arm.name,
      n: arm.times.length,
      median: median(arm.times),
      spread: relativeMad(arm.times),
      significant: false,
      lowN: arm.times.length < 4 || baseArm.times.length < 4,
      failures: arm.failures,
      ...(arm.memory.length > 0 && { memory: median(arm.memory) }),
    };
    if (arm === baseArm) return row;
    const change = row.median / baseMedian - 1;
    const p = permutationP(baseArm.times, arm.times, 10_000, random);
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

export function render(rows: Row[], markdown: boolean): string {
  const header = ["arm", "n", "median", "±MAD", "change", "p", "peak MB", "failed"];
  const body = rows.map((r) => [
    r.arm,
    `${r.n}${r.lowN ? "†" : ""}`,
    formatSeconds(r.median),
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

async function readExports(paths: string[]): Promise<z.infer<typeof Export>[]> {
  const files = paths.flatMap((path) =>
    path.endsWith(".json")
      ? [path]
      : readdirSync(path)
          .filter((f) => f.endsWith(".json"))
          .toSorted()
          .map((f) => join(path, f)),
  );
  return Promise.all(
    files.map(async (file) => {
      try {
        return Export.parse(await Bun.file(file).json());
      } catch (error) {
        throw new Error(`${file} is not a hyperfine export`, { cause: error });
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
    if (Bun.which("hyperfine") === null) throw new Error("hyperfine not found on PATH");
    mkdirSync(argv._.out, { recursive: true });
    if (readdirSync(argv._.out).some((f) => f.endsWith(".json")))
      throw new Error(`${argv._.out} already holds exports; report would pool them with this run`);
    for (let round = 0; round < argv.flags.rounds; round++) {
      const shift = round % arms.length;
      const ordered = [...arms.slice(shift), ...arms.slice(0, shift)];
      const out = join(argv._.out, `round-${String(round).padStart(3, "0")}.json`);
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
        `round ${round + 1}/${argv.flags.rounds}: ${ordered.map((a) => a.name).join(", ")} (load ${loadavg()[0]?.toFixed(1)})`,
      );
      const proc = Bun.spawnSync(args, { stdio: ["inherit", "ignore", "inherit"] });
      if (proc.exitCode !== 0)
        throw new Error(
          `hyperfine exited ${proc.exitCode} in round ${round + 1}, which it does when a run exits nonzero. Pass -i after -- to record the failed run instead`,
        );
      // oxlint-disable-next-line no-await-in-loop -- rounds run one after another, and each reports before the next starts.
      const pooled = pool([Export.parse(await Bun.file(out).json())]);
      console.error(`  ${progress(pooled)}`);
      const failed = pooled.filter((a) => a.failures > 0).map((a) => a.name);
      if (failed.length > 0)
        throw new Error(
          `${failed.join(", ")} failed in round ${round + 1}. Run each once with its output visible to find the cause before measuring`,
        );
    }
    console.error(
      `results in ${argv._.out}; next: compare.ts report ${argv._.out} --base ${arms[0]?.name}`,
    );
  },
);

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
    console.log(
      render(
        compare(arms, base, argv.flags.alpha, argv.flags.minEffect),
        argv.flags.markdown === true,
      ),
    );
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
