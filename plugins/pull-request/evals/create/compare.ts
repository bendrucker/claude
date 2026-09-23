#!/usr/bin/env bun
import { basename, dirname } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";
import { decodeFile } from "../../../../packages/decode/index";

const argv = cli({
  name: "compare.ts",
  parameters: ["<results...>"],
  flags: {
    graderNoise: {
      type: Number,
      default: 0.34,
      description: "Flag a grader whose pass rate moves by more than this",
    },
    scoreNoise: {
      type: Number,
      default: 0.2,
      description: "Flag a case score that moves by more than this",
    },
  },
  help: {
    description:
      "Compare runs of the suite. The first result is the baseline, and a row is flagged (*) when its spread across results exceeds the noise rule.",
  },
});

const Grader = z.object({ name: z.string(), passed: z.boolean(), scored: z.boolean() });
const Run = z.object({ score: z.number().nullable(), graders: z.array(Grader) });
const Result = z.object({
  cases: z.array(z.object({ name: z.string(), arms: z.record(z.string(), z.array(Run)) })),
});

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(2));

interface Cell {
  graders: Map<string, number>;
  score: number;
}

function loadCell(name: string, arm: string, runs: z.output<typeof Run>[]) {
  const tally = new Map<string, boolean[]>();
  for (const run of runs) {
    // Under ablation the with-only graders are unscored indicators, which is where skill-fired lives.
    for (const grader of run.graders) {
      const key = grader.scored ? grader.name : `${grader.name} (indicator)`;
      tally.set(key, [...(tally.get(key) ?? []), grader.passed]);
    }
  }
  const cell: Cell = {
    graders: new Map([...tally].map(([g, xs]) => [g, xs.filter(Boolean).length / xs.length])),
    score: mean(runs.flatMap((r) => (r.score === null ? [] : [r.score]))),
  };
  return [`${name}/${arm}`, cell] as const;
}

async function load(path: string): Promise<Map<string, Cell>> {
  const result = await decodeFile(Result, path);
  return new Map(
    result.cases.flatMap((c) =>
      Object.entries(c.arms).map(([arm, runs]) => loadCell(c.name, arm, runs)),
    ),
  );
}

const paths = argv._.results;
const results = await Promise.all(paths.map(load));
const labels = paths.map((p) => basename(dirname(p)));
const keys = [...new Set(results.flatMap((r) => [...r.keys()]))].toSorted();

function row(prefix: string[], values: number[], noise: number): string[] {
  const present = values.filter((v) => !Number.isNaN(v));
  const spread = present.length > 1 ? Math.max(...present) - Math.min(...present) : NaN;
  const delta = (values.at(-1) ?? NaN) - (values[0] ?? NaN);
  return [...prefix, ...values.map(fmt), fmt(delta), spread > noise + 1e-9 ? "*" : ""];
}

const header = (first: string[]) => [...first, ...labels, "delta", ""];

const graderRows = keys.flatMap((key) => {
  const names = [...new Set(results.flatMap((r) => [...(r.get(key)?.graders.keys() ?? [])]))];
  return names.toSorted().map((g) =>
    row(
      [key, g],
      results.map((r) => r.get(key)?.graders.get(g) ?? NaN),
      argv.flags.graderNoise,
    ),
  );
});
console.log(`Grader pass rate (* spread > ${argv.flags.graderNoise})`);
console.log(table([header(["case/arm", "grader"]), ...graderRows]));

const scoreRows = keys.map((key) =>
  row(
    [key],
    results.map((r) => r.get(key)?.score ?? NaN),
    argv.flags.scoreNoise,
  ),
);
console.log(`Case score (* spread > ${argv.flags.scoreNoise})`);
console.log(table([header(["case/arm"]), ...scoreRows]));
