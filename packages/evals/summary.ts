import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { native } from "./adapters/native";
import { loadColumn } from "./column";
import { flagged } from "./compare";
import { RESULT_GLOB } from "./layout";

/** A suite's newest run, by the sorted name of its results directory. */
export function latestResult(suite: string): string | undefined {
  const found = globSync(RESULT_GLOB, { cwd: suite }).toSorted();
  const last = found.at(-1);
  return last === undefined ? undefined : join(suite, last);
}

/**
 * Every `aggregate-result.json` under a directory at any depth, sorted, leaving out one nested
 * inside another result's directory, such as a post-scorer's `scored/`.
 */
export function findResults(dir: string): string[] {
  const found = globSync("**/aggregate-result.json", { cwd: dir }).map((f) => join(dir, f));
  const dirs = found.map(dirname);
  return found.filter((f) => !dirs.some((d) => dirname(f).startsWith(`${d}/`))).toSorted();
}

const Summarized = z.looseObject({
  costUsd: z.number().default(0),
  aggregates: z.looseObject({
    overallScore: z.number(),
    meanDelta: z.number().nullish(),
    casesTotal: z.number(),
  }),
});

export interface Summary {
  title: string;
  cases: number;
  costUsd: number;
  /** Rows starred against the baseline, when there is one. */
  flagged?: number;
}

export interface SummaryOptions {
  /** Runs pooled into the column this result is compared against, and its label. */
  baseline?: { label: string; paths: string[] } | undefined;
  /** Suite directory whose case tags add per-tag rows to the comparison. */
  suite?: string | undefined;
  alpha?: number | undefined;
}

/** Formats as jq's `. * 100 | round | tostring`, which rounds half away from zero and prints `-0`. */
function pct(x: number): string {
  const r = Math.sign(x) * Math.round(Math.abs(x * 100));
  return `${Object.is(r, -0) ? "-0" : r}%`;
}

/** A run's report heading and counts, read from its `aggregate-result.json`. */
export async function summarize(result: string, options: SummaryOptions = {}): Promise<Summary> {
  const { costUsd, aggregates } = Summarized.parse(await Bun.file(result).json());
  const delta = aggregates.meanDelta;
  let title = `score ${pct(aggregates.overallScore)}`;
  if (delta !== null && delta !== undefined) title += `, ${pct(delta)} over no plugin`;
  const summary: Summary = { title, cases: aggregates.casesTotal, costUsd };
  const { baseline } = options;
  if (baseline === undefined) return summary;
  const columns = await Promise.all([loadColumn(baseline.paths), loadColumn([result])]);
  const tags = options.suite === undefined ? undefined : await native.tags(options.suite);
  const count = flagged({ columns, labels: [], alpha: options.alpha ?? 0.1, tags }).length;
  return {
    ...summary,
    title: `${title}, ${count} flagged against ${baseline.label}`,
    flagged: count,
  };
}
