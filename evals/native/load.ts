import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const Grader = z.object({ name: z.string(), passed: z.boolean(), scored: z.boolean() });
const Run = z.object({ score: z.number().nullable(), graders: z.array(Grader) });
const Result = z.object({
  cases: z.array(z.object({ name: z.string(), arms: z.record(z.string(), z.array(Run)) })),
});
const TraceLine = z.object({ type: z.string(), result: z.string().optional() });
const CaseFile = z.object({ tags: z.array(z.string()).optional() });

/** Every run of one case and arm, pooled across the result files of a column. */
export interface Cell {
  graders: Map<string, boolean[]>;
  scores: number[];
  words: number[];
}

export type Column = Map<string, Cell>;

/** The final reply in a trace: its last `result` line. */
export function traceReply(trace: string): string | undefined {
  for (const line of trace.trim().split("\n").toReversed()) {
    const entry = TraceLine.parse(JSON.parse(line));
    if (entry.type === "result" && entry.result !== undefined) return entry.result;
  }
  return undefined;
}

async function replyWords(path: string): Promise<number | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return traceReply(await file.text())
    ?.split(/\s+/)
    .filter(Boolean).length;
}

interface Loaded {
  result: z.output<typeof Result>;
  words: Map<string, (number | undefined)[]>;
}

async function load(path: string): Promise<Loaded> {
  const result = Result.parse(await Bun.file(path).json());
  const traces = join(dirname(path), "traces");
  const keyed = result.cases.flatMap((c) =>
    Object.entries(c.arms).map(async ([arm, runs]) => {
      const words = await Promise.all(
        runs.map((_, i) => replyWords(join(traces, `${c.name}-${arm}-${i}.jsonl`))),
      );
      return [`${c.name}/${arm}`, words] as const;
    }),
  );
  return { result, words: new Map(await Promise.all(keyed)) };
}

function merge(column: Column, { result, words }: Loaded) {
  for (const c of result.cases) {
    for (const [arm, runs] of Object.entries(c.arms)) {
      const key = `${c.name}/${arm}`;
      const cell: Cell = column.get(key) ?? { graders: new Map(), scores: [], words: [] };
      for (const [i, run] of runs.entries()) {
        if (run.score !== null) cell.scores.push(run.score);
        const count = words.get(key)?.[i];
        if (count !== undefined) cell.words.push(count);
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
