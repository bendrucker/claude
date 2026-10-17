#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { traceReply } from "../../../../../evals/native/load";
import { leadRank, OffCpuTruth } from "./offcpu";
import { citedShare, Truth } from "./ranking";

const CaseTruth = z.union([OffCpuTruth, Truth]);
type CaseTruth = z.output<typeof CaseTruth>;

export interface Run {
  score: number;
  graders: { name: string; passed: boolean; scored: boolean }[];
}

export interface Result {
  schemaVersion: 1;
  cases: { name: string; arms: Record<string, Run[]> }[];
}

/**
 * What the native graders can't express. A ranking run scores the share of its candidates that
 * cite a profile entry, and an off-CPU run scores the reciprocal rank of its first candidate
 * targeting the true lead.
 */
export function scoreReply(reply: string, truth: CaseTruth, profile: string): Run {
  if (truth.kind === "offcpu") {
    const rank = leadRank(reply, truth);
    return { score: 1 / rank, graders: [{ name: "lead@1", passed: rank === 1, scored: true }] };
  }
  const cited = citedShare(reply, truth, profile);
  return { score: cited, graders: [{ name: "cited-all", passed: cited === 1, scored: true }] };
}

const TRACE = /^(.+)-([^-]+)-(\d+)\.jsonl$/;

/** Scores every ranking and off-CPU trace under `<results>/traces/`, by case and arm. */
export async function scoreResults(suite: string, results: string): Promise<Result> {
  const files = globSync("traces/*.jsonl", { cwd: results });
  const scored = files.map(async (file) => {
    const m = TRACE.exec(basename(file));
    if (m === null) return [];
    const [, name = "", arm = "", n = "0"] = m;
    const truthFile = Bun.file(join(suite, name, "truth.json"));
    if (!(await truthFile.exists())) return [];
    const truth = CaseTruth.parse(await truthFile.json());
    const profile = await Bun.file(join(suite, name, truth.profile)).text();
    const reply = traceReply(await Bun.file(join(results, file)).text()) ?? "";
    return [{ name, arm, n: Number(n), run: scoreReply(reply, truth, profile) }];
  });
  const cases = new Map<string, Record<string, Run[]>>();
  for (const { name, arm, n, run } of (await Promise.all(scored)).flat()) {
    const arms = cases.get(name) ?? {};
    (arms[arm] ??= [])[n] = run;
    cases.set(name, arms);
  }
  return {
    schemaVersion: 1,
    cases: [...cases]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, arms]) => ({ name, arms })),
  };
}

export const program = new Command("score.ts")
  .description(
    "Write <results>/scored.json in aggregate-result.json shape from what the native graders can't score",
  )
  .argument("<results...>", "results directories holding traces/")
  .action(async (results) => {
    const suite = join(import.meta.dir, "..");
    const writes = results.map(async (dir) => {
      const out = join(dir, "scored.json");
      await Bun.write(out, `${JSON.stringify(await scoreResults(suite, dir), null, 2)}\n`);
      return out;
    });
    console.log((await Promise.all(writes)).join("\n"));
  });

if (import.meta.main) await program.parseAsync();
