#!/usr/bin/env bun
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { listTraces, resultPath, scoredDir } from "../../../../../packages/evals/layout";
import { type Result, type ScoredRun, writeResult } from "../../../../../packages/evals/result";
import { traceReply } from "../../../../../packages/evals/trace";
import { leadRank, OffCpuTruth } from "./offcpu";
import { citedShare, Truth } from "./ranking";

const CaseTruth = z.union([OffCpuTruth, Truth]);
type CaseTruth = z.output<typeof CaseTruth>;

/**
 * What the native graders can't express. A ranking run scores the share of its candidates that
 * cite a profile entry, and an off-CPU run scores the reciprocal rank of its first candidate
 * targeting the true lead.
 */
export function scoreReply(reply: string, truth: CaseTruth, profile: string): ScoredRun {
  if (truth.kind === "offcpu") {
    const rank = leadRank(reply, truth);
    return { score: 1 / rank, graders: [{ name: "lead@1", passed: rank === 1 }] };
  }
  const cited = citedShare(reply, truth, profile);
  return { score: cited, graders: [{ name: "cited-all", passed: cited === 1 }] };
}

/**
 * Scores every ranking and off-CPU trace under `<results>/traces/` and writes the runs to
 * `<results>/scored/aggregate-result.json`, where `compare.ts` reads them as a column.
 */
export async function scoreResults(suite: string, results: string): Promise<Result> {
  const scored = listTraces(results).map(async (ref) => {
    const truthFile = Bun.file(join(suite, ref.case, "truth.json"));
    if (!(await truthFile.exists())) return [];
    const truth = CaseTruth.parse(await truthFile.json());
    const profile = await Bun.file(join(suite, ref.case, truth.profile)).text();
    const reply = traceReply(await Bun.file(ref.path).text()) ?? "";
    return [{ ...ref, run: scoreReply(reply, truth, profile) }];
  });
  const cases: Record<string, Record<string, { n: number; run: ScoredRun }[]>> = {};
  for (const { case: name, arm, n, run } of (await Promise.all(scored)).flat()) {
    ((cases[name] ??= {})[arm] ??= []).push({ n, run });
  }
  const sorted = Object.fromEntries(
    Object.entries(cases)
      .toSorted(([x], [y]) => x.localeCompare(y))
      .map(([name, arms]) => [
        name,
        Object.fromEntries(
          Object.entries(arms).map(([arm, list]) => [
            arm,
            list.toSorted((x, y) => x.n - y.n).map((r) => r.run),
          ]),
        ),
      ]),
  );
  return writeResult(scoredDir(results), sorted);
}

export const program = new Command("score.ts")
  .description(
    "Write <results>/scored/aggregate-result.json from what the native graders can't score",
  )
  .argument("<results...>", "results directories holding traces/")
  .action(async (results) => {
    const suite = join(import.meta.dir, "..");
    const writes = results.map(async (dir) => {
      await scoreResults(suite, dir);
      return resultPath(scoredDir(dir));
    });
    console.log((await Promise.all(writes)).join("\n"));
  });

if (import.meta.main) await program.parseAsync();
