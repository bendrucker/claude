#!/usr/bin/env bun
import { basename, join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";
import { type Graders, loadGraders, verdict } from "./check";
import { traceReply } from "./load";

const Grader = z.looseObject({
  name: z.string(),
  passed: z.boolean(),
  weight: z.number(),
  scored: z.boolean(),
  withOnly: z.boolean(),
  explanation: z.string().optional(),
});
const Run = z.looseObject({ score: z.number().nullable(), graders: z.array(Grader) });
export const Result = z.looseObject({
  cases: z.array(z.looseObject({ name: z.string(), arms: z.record(z.string(), z.array(Run)) })),
});

type Run = z.output<typeof Run>;

/** The runner's run score: the weighted pass rate of its scored graders on that arm. */
export function score(run: Run, arm: string): number | null {
  const graders = run.graders.filter((g) => g.scored && (arm === "with" || !g.withOnly));
  const total = graders.reduce((sum, g) => sum + g.weight, 0);
  if (total === 0) return run.score;
  return graders.reduce((sum, g) => sum + (g.passed ? g.weight : 0), 0) / total;
}

export interface Flip {
  grader: string;
  run: string;
  passed: boolean;
}

/**
 * Re-grades one run's regex graders against its trace. A grader the trace cannot reach, such as
 * an `llm` grader or a file target, keeps its recorded verdict.
 */
export function regradeRun(run: Run, arm: string, graders: Graders, trace: string): Run {
  const recorded = { reply: traceReply(trace) ?? "", trace };
  const regraded = run.graders.map((g) => {
    const grader = graders.get(g.name);
    const passed = grader === undefined ? undefined : verdict(grader, recorded);
    return passed === undefined ? g : { ...g, passed, explanation: "regraded from the trace" };
  });
  const next = { ...run, graders: regraded };
  return run.score === null ? next : { ...next, score: score(next, arm) };
}

/**
 * Re-grades a results directory against the suite's current graders and writes the result,
 * with its traces, to `<out>`. Returns the verdicts that changed.
 */
export async function regrade(suite: string, results: string, out: string): Promise<Flip[]> {
  const result = Result.parse(await Bun.file(join(results, "aggregate-result.json")).json());
  const flips: Flip[] = [];
  const cases = await Promise.all(
    result.cases.map(async (c) => {
      const graders = await loadGraders(join(suite, c.name));
      const arms = await Promise.all(
        Object.entries(c.arms).map(async ([arm, runs]) => {
          const next = await Promise.all(
            runs.map(async (run, i) => {
              const id = `${c.name}-${arm}-${i}`;
              const file = Bun.file(join(results, "traces", `${id}.jsonl`));
              if (!(await file.exists())) return run;
              const regraded = regradeRun(run, arm, graders, await file.text());
              for (const [j, g] of regraded.graders.entries()) {
                if (g.passed !== run.graders[j]?.passed)
                  flips.push({ grader: `${c.name}/${g.name}`, run: id, passed: g.passed });
              }
              return regraded;
            }),
          );
          return [arm, next] as const;
        }),
      );
      return { ...c, arms: Object.fromEntries(arms) };
    }),
  );
  // The aggregates summarize the recorded scores, so a regraded result drops them.
  const { aggregates: _, ...rest } = result;
  await Bun.write(join(out, "aggregate-result.json"), JSON.stringify({ ...rest, cases }, null, 2));
  await $`cp -R ${join(results, "traces")} ${out}/`.quiet().nothrow();
  return flips;
}

if (import.meta.main) {
  const argv = cli({
    name: "regrade.ts",
    parameters: ["<suite>", "<results...>"],
    help: {
      description:
        "Re-grade stored runs against the suite's current regex graders, so a grader fix needs no new sessions. Reads each results directory's traces/ and writes <results>-regraded/ beside it for compare.ts. llm and file-target graders keep their recorded verdicts.",
    },
  });
  const outs = argv._.results.map((r) => join(r, "..", `${basename(r)}-regraded`));
  const all = await Promise.all(
    argv._.results.map((r, i) => regrade(argv._.suite, r, outs[i] ?? "")),
  );
  for (const [i, flips] of all.entries()) {
    for (const f of flips)
      console.log(`${f.run}: ${f.grader} now ${f.passed ? "passes" : "fails"}`);
    console.log(`${outs[i]}: ${flips.length} verdicts changed`);
  }
}
