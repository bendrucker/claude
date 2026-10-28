import { mean } from "simple-statistics";
import { z } from "zod";
import { type RunRef, resultPath, tracePath } from "./layout";

/**
 * The runner's `aggregate-result.json`, parsed loosely: the runner adds fields without renaming
 * old ones, and a post-scorer writes only the fields below.
 */
export const Grader = z.looseObject({
  name: z.string(),
  passed: z.boolean(),
  weight: z.number().default(1),
  /** False for a grader left out of the score, such as a with-only indicator under ablation. */
  scored: z.boolean().default(true),
  withOnly: z.boolean().default(false),
  explanation: z.string().nullish(),
});
export const Run = z.looseObject({
  score: z.number().nullable().default(null),
  graders: z.array(Grader).default([]),
  error: z.string().nullish(),
  tracePath: z.string().nullish(),
  /** Present when a mock stopped the run, which scores 0 whatever its graders say. */
  aborted: z.unknown().optional(),
});
export const Case = z.looseObject({
  name: z.string(),
  arms: z.record(z.string(), z.array(Run)),
});
export const Result = z.looseObject({ cases: z.array(Case) });

export type Grader = z.output<typeof Grader>;
export type Run = z.output<typeof Run>;
export type Case = z.output<typeof Case>;
export type Result = z.output<typeof Result>;

export async function readResult(path: string): Promise<Result> {
  return Result.parse(await Bun.file(path).json());
}

/**
 * The runner's run score: the weighted pass rate of its scored graders on that arm. A run with
 * nothing to score, such as one that ended on an API error, or one a mock aborted keeps its
 * recorded score.
 */
export function score(run: Run, arm: string): number | null {
  if (run.aborted !== undefined) return run.score;
  const graders = run.graders.filter((g) => g.scored && (arm === "with" || !g.withOnly));
  const total = graders.reduce((sum, g) => sum + g.weight, 0);
  if (total === 0) return run.score;
  return graders.reduce((sum, g) => sum + (g.passed ? g.weight : 0), 0) / total;
}

/**
 * Why a run failed outside the artifact under test, such as a session limit or a judge call
 * that threw, or undefined for a clean run.
 */
export function runError(run: Run): string | undefined {
  const threw = run.graders.find((g) => g.explanation?.startsWith("grader threw") === true);
  return run.error ?? threw?.explanation ?? undefined;
}

export interface Errored {
  /** `<case>/<arm>/<n>: <error>` */
  label: string;
  /** Whether the runner graded the run anyway, as it does after a timeout or a turn cap. */
  graded: boolean;
}

/** The errored runs in a result. */
export function erroredRuns(result: Result): Errored[] {
  return result.cases.flatMap((c) =>
    Object.entries(c.arms).flatMap(([arm, runs]) =>
      runs.flatMap((run, i) => {
        const error = runError(run);
        if (error === undefined) return [];
        return [{ label: `${c.name}/${arm}/${i}: ${error}`, graded: run.graders.length > 0 }];
      }),
    ),
  );
}

export interface ScoredRun {
  /** Verdicts, with the runner's defaults for an omitted weight, `scored`, or `withOnly`. */
  graders: z.input<typeof Grader>[];
  /** Overrides the score derived from the graders, for a scorer that ranks. */
  score?: number | undefined;
  metrics?: Record<string, number> | undefined;
  /** The run's final reply, written as its trace so `compare.ts` counts its words. */
  reply?: string | undefined;
  /** A source trace to copy as the run's trace, in place of `reply`. */
  trace?: string | undefined;
  error?: string | undefined;
}

const meanOf = (xs: number[]) => (xs.length > 0 ? mean(xs) : null);

/**
 * Writes a post-scorer's runs as `<dir>/aggregate-result.json`, scored the way the runner
 * scores, with a trace per run that has a reply, so `compare.ts`, `regrade.ts`, and
 * `report.ts` read it like a native result.
 */
export async function writeResult(
  dir: string,
  cases: Record<string, Record<string, ScoredRun[]>>,
): Promise<Result> {
  const traces: Promise<number>[] = [];
  const written = Object.entries(cases).map(([name, arms]) => {
    const scored = Object.fromEntries(
      Object.entries(arms).map(([arm, runs]) => [
        arm,
        runs.map((r, i): Run => {
          if (r.trace !== undefined) {
            traces.push(Bun.write(tracePath(dir, name, arm, i), Bun.file(r.trace)));
          } else if (r.reply !== undefined) {
            const line = JSON.stringify({ type: "result", result: r.reply });
            traces.push(Bun.write(tracePath(dir, name, arm, i), line));
          }
          const run = Run.parse({ score: 0, graders: r.graders, error: r.error ?? null });
          const metrics = r.metrics === undefined ? {} : { metrics: r.metrics };
          return { ...run, ...metrics, score: r.score ?? score(run, arm) };
        }),
      ]),
    );
    const withScore = meanOf(scored.with?.flatMap((r) => r.score ?? []) ?? []);
    const without = meanOf(scored.without?.flatMap((r) => r.score ?? []) ?? []);
    const delta = withScore === null || without === null ? undefined : withScore - without;
    return { name, aggregates: { score: withScore, scoreWithout: without, delta }, arms: scored };
  });
  const result = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    aggregates: {
      overallScore: meanOf(written.flatMap((c) => c.aggregates.score ?? [])),
      casesTotal: written.length,
    },
    cases: written,
  };
  await Promise.all([...traces, Bun.write(resultPath(dir), JSON.stringify(result, null, 2))]);
  return Result.parse(result);
}

/** Every run in a result, in case, arm, and run order. */
export function* eachRun(result: Result): Iterable<RunRef & { run: Run }> {
  for (const c of result.cases)
    for (const [arm, list] of Object.entries(c.arms))
      for (const [n, run] of list.entries()) yield { case: c.name, arm, n, run };
}
