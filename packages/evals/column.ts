import { dirname, join } from "node:path";
import { readResult, type Result, runError } from "./result";
import { type Measure, type Measured, measures, traceMeasures } from "./trace";

/** Every run of one case and arm, pooled across the result files of a column. */
export interface Cell extends Record<Measure, number[]> {
  graders: Map<string, boolean[]>;
  scores: number[];
  /** Runs left out of the pool because they errored. */
  errored: number;
}

export type Column = Map<string, Cell>;

async function measure(path: string): Promise<Measured> {
  const file = Bun.file(path);
  return (await file.exists()) ? traceMeasures(await file.text()) : {};
}

interface Loaded {
  result: Result;
  measured: Map<string, Measured[]>;
}

async function load(path: string): Promise<Loaded> {
  const result = await readResult(path);
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
