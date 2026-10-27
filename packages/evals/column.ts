import type { z } from "zod";
import type { Adapter } from "./adapter";
import { native } from "./adapters/native";
import { Result, runError } from "./result";
import { type Measure, type Measured, measures } from "./trace";

/** Every run of one case and arm, pooled across the result files of a column. */
export interface Cell extends Record<Measure, number[]> {
  graders: Map<string, boolean[]>;
  scores: number[];
  /** Runs left out of the pool because they errored. */
  errored: number;
}

export type Column = Map<string, Cell>;

export interface Loaded {
  /** Parsed with `Result` before pooling, so grader and run defaults may be left out. */
  result: z.input<typeof Result>;
  /** Trace measures per `<case>/<arm>`, one entry per run. A run without one has no measures. */
  measured: Map<string, Measured[]>;
}

function pool(cell: Cell, values: Measured) {
  for (const m of measures) {
    const value = values[m];
    if (value !== undefined) cell[m].push(value);
  }
}

function merge(column: Column, result: Result, measured: Loaded["measured"]) {
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

/** Loads a column from one or more stored runs, pooling their runs. */
export async function loadColumn(paths: string[], adapter: Adapter = native): Promise<Column> {
  const column: Column = new Map();
  const loaded = await Promise.all(paths.map((p) => adapter.read(p)));
  for (const { result, measured } of loaded) merge(column, Result.parse(result), measured);
  return column;
}
