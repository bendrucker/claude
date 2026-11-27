#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";

const RunGrader = z.object({
  name: z.string(),
  passed: z.boolean(),
  weight: z.number(),
  scored: z.boolean(),
});
const Run = z.object({
  score: z.number(),
  tracePath: z.string().nullable(),
  graders: z.array(RunGrader),
});
const Case = z.object({
  name: z.string(),
  dir: z.string(),
  graders: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      config: z.looseObject({ pattern: z.string().optional() }),
    }),
  ),
  arms: z.record(z.string(), z.array(Run)),
});
const Aggregate = z.object({ cases: z.array(Case) });
type Case = z.infer<typeof Case>;
type Run = z.infer<typeof Run>;

const SUITE = join(import.meta.dirname, "..");
const SCORING_FILES = ["bunfig.toml", "test/setup.ts", "test/samples.bin"];

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
  const dir = await mkdtemp(join(tmpdir(), `rescore-${name}-`));
  const { exit, output } = await spawn(["bash", join(SUITE, name, "fixture.sh")], dir);
  if (exit !== 0) throw new Error(`${name}: fixture.sh failed\n${output}`);
  return dir;
}

async function holdoutOutput(workspace: string, clean: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rescore-run-"));
  await spawn(["cp", "-R", `${workspace}/.`, dir], tmpdir());
  await Promise.all(
    [".git", "node_modules"].map((part) => rm(join(dir, part), { recursive: true, force: true })),
  );
  await Promise.all(
    SCORING_FILES.map(async (file) => {
      const source = Bun.file(join(clean, file));
      if (await source.exists()) await Bun.write(join(dir, file), source);
    }),
  );
  return (await spawn(["bun", "--preload", "./test/setup.ts", "--eval", "0"], dir)).output;
}

function score(graders: Run["graders"]): number {
  const scored = graders.filter((g) => g.scored);
  const total = scored.reduce((sum, g) => sum + g.weight, 0);
  return total > 0 ? scored.reduce((sum, g) => sum + (g.passed ? g.weight : 0), 0) / total : 0;
}

async function rescoreRun(
  run: Run,
  tokens: Map<string, RegExp>,
  clean: string,
): Promise<number | undefined> {
  if (run.tracePath === null) return undefined;
  const workspace = join(dirname(dirname(run.tracePath)), "home", "cwd");
  if (!(await Bun.file(join(workspace, "package.json")).exists())) return undefined;
  const output = await holdoutOutput(workspace, clean);
  return score(
    run.graders.map((g) => {
      const pattern = tokens.get(g.name);
      return pattern ? { ...g, passed: pattern.test(output) } : g;
    }),
  );
}

async function rescoreCase(c: Case): Promise<string[]> {
  const tokens = new Map(
    c.graders.flatMap((g) =>
      g.type === "regex" && g.config.pattern?.includes(" cache:")
        ? [[g.name, new RegExp(g.config.pattern)] as const]
        : [],
    ),
  );
  if (tokens.size === 0) return [];
  const clean = await pristine(basename(c.dir));
  return Promise.all(
    Object.entries(c.arms).map(async ([arm, runs]) => {
      const scores = await Promise.all(runs.map((run) => rescoreRun(run, tokens, clean)));
      const cells = runs.map(
        (run, i) => `${run.score.toFixed(2)}→${scores[i]?.toFixed(2) ?? "n/a"}`,
      );
      const found = scores.filter((s) => s !== undefined);
      const mean =
        found.length > 0 ? (found.reduce((a, b) => a + b, 0) / found.length).toFixed(2) : "n/a";
      return `${c.name} [${arm}] mean ${mean}  runs ${cells.join(" ")}`;
    }),
  );
}

export const program = new Command("rescore")
  .description(
    "Rescore token-graded cases from each run's final workspace instead of the trace. Needs a run made with --keep-temp.",
  )
  .argument("<aggregate>", "aggregate-result.json from the eval run")
  .action(async (path) => {
    const { cases } = Aggregate.parse(await Bun.file(path).json());
    const lines = await Promise.all(cases.map(rescoreCase));
    for (const line of lines.flat()) console.log(line);
  });

if (import.meta.main) await program.parseAsync();
