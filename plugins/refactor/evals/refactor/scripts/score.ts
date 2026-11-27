#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { $ } from "bun";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { artifactsPath, resultPath } from "../../../../../packages/evals/layout";
import {
  Case as RunnerCase,
  type Grader,
  Result as RunnerResult,
} from "../../../../../packages/evals/result";

const CaseGrader = z.looseObject({
  name: z.string(),
  type: z.string(),
  config: z.looseObject({ pattern: z.string().optional(), arm: z.string().optional() }).default({}),
});
export const Case = RunnerCase.extend({
  graders: z.array(CaseGrader).default([]),
  aggregates: z.looseObject({}).default({}),
});
export const Result = RunnerResult.extend({
  cases: z.array(Case),
  aggregates: z.looseObject({}).default({}),
});
export type Case = z.output<typeof Case>;
export type Result = z.output<typeof Result>;

const SUITE = join(import.meta.dirname, "..");
const SCORING_FILES = ["bunfig.toml", "test/setup.ts", "test/samples.bin"];

/** Graders that check the skill's own conventions, kept as verdicts but left out of the score. */
export const POLICY = new Set(["old-kept", "compared-both"]);

/** A token grader's pattern, which matches the line the case's test preload prints. */
export function tokenPattern(grader: Case["graders"][number]): RegExp | undefined {
  if (grader.type !== "regex") return undefined;
  const { pattern } = grader.config;
  return pattern?.includes(" cache:") ? new RegExp(pattern) : undefined;
}

async function spawn(cmd: string[], cwd: string): Promise<{ exit: number; output: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 120_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, output: stdout + stderr };
}

async function pristine(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `score-${name}-`));
  const { exit, output } = await spawn(["bash", join(SUITE, name, "fixture.sh")], dir);
  if (exit !== 0) throw new Error(`${name}: fixture.sh failed\n${output}`);
  return dir;
}

/** The token line the pristine preload prints over a run's collected workspace. */
export async function tokenOutput(workspace: string, clean: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "score-run-"));
  await $`cp -R ${workspace}/. ${dir}`.quiet();
  await Promise.all(
    [".git", "node_modules"].map((part) => rm(join(dir, part), { recursive: true, force: true })),
  );
  await Promise.all(
    SCORING_FILES.map(async (file) => {
      const source = Bun.file(join(clean, file));
      if (await source.exists()) await Bun.write(join(dir, file), source);
    }),
  );
  const { output } = await spawn(["bun", "--preload", "./test/setup.ts", "--eval", "0"], dir);
  await rm(dir, { recursive: true, force: true });
  return output;
}

/** Replaces each token grader's trace verdict with one read from the workspace output. */
export function applyTokens(
  graders: Grader[],
  tokens: Map<string, RegExp>,
  output: string,
): Grader[] {
  return graders.map((g) => {
    const pattern = tokens.get(g.name);
    if (pattern === undefined) return g;
    const passed = pattern.test(output);
    return {
      ...g,
      passed,
      explanation: `rescored from the workspace: ${passed ? "matched" : "no match"}`,
    };
  });
}

/** Names of a case's with-only indicators, such as `skill-fired`, reported as a trigger rate. */
export const indicators = (c: Case): Set<string> =>
  new Set(c.graders.filter((g) => g.config.arm === "with-only").map((g) => g.name));

/** Keeps policy and indicator verdicts but leaves them out of the score. */
export const unscore = (graders: Grader[], names: Set<string>): Grader[] =>
  graders.map((g) => (POLICY.has(g.name) || names.has(g.name) ? { ...g, scored: false } : g));

/** The weighted pass rate of a run's scored graders, or null when none are scored. */
export function runScore(graders: Grader[]): number | null {
  const scored = graders.filter((g) => g.scored);
  const total = scored.reduce((sum, g) => sum + g.weight, 0);
  return total > 0 ? scored.reduce((sum, g) => sum + (g.passed ? g.weight : 0), 0) / total : null;
}

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Rebuilds the case and suite aggregates from the scored graders. A case with no scored grader
 * on an arm, such as a trigger probe, drops out of the delta.
 */
export function reaggregate(result: Result): Result {
  const cases = result.cases.map((c) => {
    const names = indicators(c);
    const arms = Object.fromEntries(
      Object.entries(c.arms).map(([arm, runs]) => [
        arm,
        runs.map((run) => ({ ...run, score: runScore(run.graders) })),
      ]),
    );
    const armMean = (arm: string) => mean(arms[arm]?.flatMap((r) => r.score ?? []) ?? []);
    const withScore = armMean("with");
    const without = armMean("without");
    const delta = withScore === null || without === null ? null : withScore - without;
    const fired = (arms.with ?? []).map((r) =>
      r.graders.filter((g) => names.has(g.name)).every((g) => g.passed),
    );
    const triggerRate = names.size > 0 ? mean(fired.map(Number)) : null;
    return {
      ...c,
      arms,
      aggregates: { ...c.aggregates, score: withScore, scoreWithout: without, delta, triggerRate },
    };
  });
  const scores = cases.flatMap((c) => c.aggregates.score ?? []);
  const deltas = cases.flatMap((c) => c.aggregates.delta ?? []);
  return {
    ...result,
    cases,
    aggregates: { ...result.aggregates, overallScore: mean(scores), meanDelta: mean(deltas) },
  };
}

async function rescoreCase(c: Case, output: string): Promise<Case> {
  const names = indicators(c);
  const tokens = new Map(
    c.graders.flatMap((g) => {
      const pattern = tokenPattern(g);
      return pattern === undefined ? [] : [[g.name, pattern] as const];
    }),
  );
  const clean = tokens.size > 0 ? await pristine(c.name) : undefined;
  const rescored = await Promise.all(
    Object.entries(c.arms).map(async ([arm, runs]) => {
      const next = await Promise.all(
        runs.map(async (run, i) => {
          let graders = unscore(run.graders, names);
          const workspace = artifactsPath(output, c.name, arm, i);
          if (clean !== undefined && (await Bun.file(join(workspace, "package.json")).exists()))
            graders = applyTokens(graders, tokens, await tokenOutput(workspace, clean));
          return { ...run, graders };
        }),
      );
      return [arm, next] as const;
    }),
  );
  if (clean !== undefined) await rm(clean, { recursive: true, force: true });
  return { ...c, arms: Object.fromEntries(rescored) };
}

if (import.meta.main) {
  const [output] = process.argv.slice(2);
  if (output === undefined) throw new Error("usage: score.ts <results dir>");
  const path = resultPath(output);
  const result = Result.parse(await Bun.file(path).json());
  const cases = await Promise.all(result.cases.map((c) => rescoreCase(c, output)));
  await Bun.write(path, JSON.stringify(reaggregate({ ...result, cases }), null, 2));
}
