import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const Grader = z.object({
  name: z.string(),
  passed: z.boolean(),
  scored: z.boolean(),
  explanation: z.string().nullish(),
});
const Run = z.object({
  score: z.number().nullable(),
  graders: z.array(Grader),
  error: z.string().nullish(),
});
const Result = z.object({
  cases: z.array(z.object({ name: z.string(), arms: z.record(z.string(), z.array(Run)) })),
});
const TraceLine = z.object({ type: z.string(), result: z.string().optional() });
const ResultLine = TraceLine.extend({
  num_turns: z.number().nullish(),
  duration_ms: z.number().nullish(),
  total_cost_usd: z.number().nullish(),
  usage: z.object({ output_tokens: z.number().nullish() }).nullish(),
});
const CaseFile = z.object({ tags: z.array(z.string()).optional() });

export const measures = ["words", "turns", "seconds", "tokens", "cost"] as const;
export type Measure = (typeof measures)[number];
type Measured = Partial<Record<Measure, number | undefined>>;

/** Every run of one case and arm, pooled across the result files of a column. */
export interface Cell extends Record<Measure, number[]> {
  graders: Map<string, boolean[]>;
  scores: number[];
  /** Runs left out of the pool because they errored. */
  errored: number;
}

export type Column = Map<string, Cell>;

/**
 * Why a run failed outside the artifact under test, such as a session limit or a judge call
 * that threw, or undefined for a clean run. The runner scores an errored run like any other,
 * and an empty reply passes every `not_contains` grader.
 */
export function runError(run: z.output<typeof Run>): string | undefined {
  const threw = run.graders.find((g) => g.explanation?.startsWith("grader threw") === true);
  return run.error ?? threw?.explanation ?? undefined;
}

/** The errored runs in an aggregate-result.json, as `<case>/<arm>/<n>: <error>`. */
export async function erroredRuns(path: string): Promise<string[]> {
  const result = Result.parse(await Bun.file(path).json());
  return result.cases.flatMap((c) =>
    Object.entries(c.arms).flatMap(([arm, runs]) =>
      runs.flatMap((run, i) => {
        const error = runError(run);
        return error === undefined ? [] : [`${c.name}/${arm}/${i}: ${error}`];
      }),
    ),
  );
}

/** The final reply in a trace: its last `result` line. */
export function traceReply(trace: string): string | undefined {
  for (const line of trace.trim().split("\n").toReversed()) {
    const entry = TraceLine.parse(JSON.parse(line));
    if (entry.type === "result" && entry.result !== undefined) return entry.result;
  }
  return undefined;
}

/** A trace's measures from its last `result` line, each absent when that line lacks it. */
export function traceMeasures(trace: string): Measured {
  const line = trace
    .split("\n")
    .filter((l) => l.trim() !== "")
    .findLast((l) => TraceLine.parse(JSON.parse(l)).type === "result");
  if (line === undefined) return {};
  const last = ResultLine.parse(JSON.parse(line));
  return {
    words: last.result?.split(/\s+/).filter(Boolean).length,
    turns: last.num_turns ?? undefined,
    seconds: last.duration_ms == null ? undefined : last.duration_ms / 1000,
    tokens: last.usage?.output_tokens ?? undefined,
    cost: last.total_cost_usd ?? undefined,
  };
}

async function measure(path: string): Promise<Measured> {
  const file = Bun.file(path);
  return (await file.exists()) ? traceMeasures(await file.text()) : {};
}

interface Loaded {
  result: z.output<typeof Result>;
  measured: Map<string, Measured[]>;
}

async function load(path: string): Promise<Loaded> {
  const result = Result.parse(await Bun.file(path).json());
  const traces = join(dirname(path), "traces");
  const keyed = result.cases.flatMap((c) =>
    Object.entries(c.arms).map(async ([arm, runs]) => {
      const measured = await Promise.all(
        runs.map((_, i) => measure(join(traces, `${c.name}-${arm}-${i}.jsonl`))),
      );
      return [`${c.name}/${arm}`, measured] as const;
    }),
  );
  return { result, measured: new Map(await Promise.all(keyed)) };
}

function pool(cell: Cell, values: Measured) {
  for (const m of measures) {
    const value = values[m];
    if (value !== undefined) cell[m].push(value);
  }
}

function merge(column: Column, { result, measured }: Loaded) {
  for (const c of result.cases) {
    for (const [arm, runs] of Object.entries(c.arms)) {
      const key = `${c.name}/${arm}`;
      const cell: Cell = column.get(key) ?? {
        graders: new Map(),
        scores: [],
        errored: 0,
        words: [],
        turns: [],
        seconds: [],
        tokens: [],
        cost: [],
      };
      for (const [i, run] of runs.entries()) {
        if (runError(run) !== undefined) {
          cell.errored += 1;
          continue;
        }
        if (run.score !== null) cell.scores.push(run.score);
        pool(cell, measured.get(key)?.[i] ?? {});
        // Under ablation the with-only graders are unscored indicators, such as a skill firing.
        for (const grader of run.graders) {
          const name = grader.scored ? grader.name : `${grader.name} (indicator)`;
          const passes = cell.graders.get(name) ?? [];
          passes.push(grader.passed);
          cell.graders.set(name, passes);
        }
      }
      column.set(key, cell);
    }
  }
}

/** Loads a column from one or more aggregate-result.json paths, pooling their runs. */
export async function loadColumn(paths: string[]): Promise<Column> {
  const column: Column = new Map();
  for (const loaded of await Promise.all(paths.map(load))) merge(column, loaded);
  return column;
}

/** Maps each case in a suite directory to the tags its case.yaml declares. */
export async function loadTags(suite: string): Promise<Map<string, string[]>> {
  const cases = readdirSync(suite, { withFileTypes: true }).filter((e) => e.isDirectory());
  const entries = await Promise.all(
    cases.map(async ({ name }) => {
      const file = Bun.file(join(suite, name, "case.yaml"));
      if (!(await file.exists())) return undefined;
      return [name, CaseFile.parse(parse(await file.text())).tags ?? []] as const;
    }),
  );
  return new Map(entries.filter((e) => e !== undefined));
}
