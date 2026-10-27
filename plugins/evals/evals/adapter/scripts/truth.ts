import { join } from "node:path";
import { z } from "zod";
import { Result } from "../../../../../packages/evals/result";

const RunTruth = z.object({
  /** Each grader's verdict on this run, by the framework's own grader name. */
  graders: z.record(z.string(), z.boolean()),
  reply: z.string(),
});

/** What a correct adapter reports for one stored run, kept beside it as `truth.json`. */
export const Truth = z.object({
  /** The path, relative to the fixture run, that `read` and `traces` take. */
  result: z.string(),
  cases: z.record(
    z.string(),
    z.object({
      tags: z.array(z.string()),
      /** Runs under `with` and `without`, in the framework's run order. */
      arms: z.record(z.string(), z.array(RunTruth)),
    }),
  ),
  rescore: z.discriminatedUnion("supported", [
    z.object({
      supported: z.literal(true),
      /** The verdicts `rescore.patch` changes. */
      flips: z.array(
        z.object({ case: z.string(), arm: z.string(), run: z.number(), grader: z.string() }),
      ),
    }),
    z.object({ supported: z.literal(false), reason: z.string() }),
  ]),
});
export type Truth = z.output<typeof Truth>;

export async function readTruth(run: string): Promise<Truth> {
  return Truth.parse(await Bun.file(join(run, "truth.json")).json());
}

/** `<case>/<arm>/<grader>` to `<passed>/<runs>`, the counts `read` must reproduce. */
export type Counts = Map<string, string>;

export function truthCounts(truth: Truth): Counts {
  const counts: Counts = new Map();
  for (const [name, c] of Object.entries(truth.cases))
    for (const [arm, runs] of Object.entries(c.arms)) {
      const graders = new Set(runs.flatMap((r) => Object.keys(r.graders)));
      for (const g of graders)
        counts.set(
          `${name}/${arm}/${g}`,
          `${runs.filter((r) => r.graders[g] === true).length}/${runs.length}`,
        );
    }
  return counts;
}

export function resultCounts(input: z.input<typeof Result>): Counts {
  const counts: Counts = new Map();
  for (const c of Result.parse(input).cases)
    for (const [arm, runs] of Object.entries(c.arms)) {
      const graders = new Set(runs.flatMap((r) => r.graders.map((g) => g.name)));
      for (const g of graders) {
        const passed = runs.filter((r) => r.graders.some((x) => x.name === g && x.passed)).length;
        counts.set(`${c.name}/${arm}/${g}`, `${passed}/${runs.length}`);
      }
    }
  return counts;
}

/** The first mismatch between two count maps, or undefined when they agree. */
export function countsDiffer(want: Counts, got: Counts): string | undefined {
  for (const [key, value] of want)
    if (got.get(key) !== value) return `${key}: want ${value}, got ${got.get(key) ?? "none"}`;
  for (const key of got.keys()) if (!want.has(key)) return `${key}: not in the truth`;
  return undefined;
}
