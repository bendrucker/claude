import { $ } from "bun";
import { caseGraders, type Graders, RegexGrader, verdict } from "./graders";
import { artifactsDir, resultPath, runId, tracePath, tracesDir } from "./layout";
import { type Result, readResult, type Run, score } from "./result";
import { scoreSuite } from "./score";
import { traceReply } from "./trace";

export interface Flip {
  grader: string;
  run: string;
  /** The new verdict, or undefined when the grader file is gone and its verdict dropped. */
  passed: boolean | undefined;
}

/**
 * Re-grades one run against the case's current graders and its trace. A regex grader the trace
 * reaches gets a fresh verdict, weight, and arm from its current file, including one added
 * since the run or swapped in from another type. A grader whose file is gone drops out. Any
 * other grader, such as an `llm` grader or a file target, keeps its recorded verdict.
 */
export function regradeRun(run: Run, arm: string, graders: Graders, trace: string): Run {
  const recorded = { reply: traceReply(trace) ?? "", trace };
  const known = new Set(run.graders.map((g) => g.name));
  const regraded = (name: string, explanation: string) => {
    const grader = graders.get(name);
    const parsed = RegexGrader.safeParse(grader);
    if (grader === undefined || !parsed.success) return undefined;
    const withOnly = parsed.data.arm === "with-only";
    const passed = verdict(grader, recorded);
    if (passed === undefined) return undefined;
    if (withOnly && arm !== "with") return [];
    const { weight } = parsed.data;
    return [{ name, passed, weight, scored: !withOnly, withOnly, explanation }];
  };
  const kept = run.graders.flatMap((g) => {
    if (!graders.has(g.name)) return [];
    const fresh = regraded(g.name, "regraded from the trace");
    return fresh === undefined ? [g] : fresh.flatMap((r) => [{ ...g, ...r }]);
  });
  const added = [...graders.keys()]
    .filter((name) => !known.has(name))
    .flatMap((name) => regraded(name, "graded from the trace") ?? []);
  const next = { ...run, graders: [...kept, ...added] };
  return run.score === null ? next : { ...next, score: score(next, arm) };
}

/** The verdicts that differ between two versions of a run, by grader name. */
function diff(before: Run, after: Run): [string, boolean | undefined][] {
  const was = new Map(before.graders.map((g) => [g.name, g.passed]));
  const now = new Map(after.graders.map((g) => [g.name, g.passed]));
  return [...new Set([...was.keys(), ...now.keys()])]
    .filter((name) => was.get(name) !== now.get(name))
    .map((name) => [name, now.get(name)]);
}

/**
 * Re-grades a results directory against the suite's current graders and writes the result,
 * with its traces, to `<out>`. Returns the verdicts that changed.
 */
export async function regrade(suite: string, results: string, out: string): Promise<Flip[]> {
  const result = await readResult(resultPath(results));
  const cases = await Promise.all(
    result.cases.map(async (c) => {
      const graders = await caseGraders(suite, c.name);
      // A case missing from the suite would otherwise drop every grader.
      if (graders.size === 0) return c;
      const arms = await Promise.all(
        Object.entries(c.arms).map(async ([arm, runs]) => {
          const next = await Promise.all(
            runs.map(async (run, i) => {
              const file = Bun.file(tracePath(results, c.name, arm, i));
              if (!(await file.exists())) return run;
              return regradeRun(run, arm, graders, await file.text());
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
  await Bun.write(resultPath(out), JSON.stringify({ ...rest, cases }, null, 2));
  await $`cp -R ${tracesDir(results)} ${artifactsDir(results)} ${out}/`.quiet().nothrow();
  await scoreSuite(suite, out);
  return flips(result, await readResult(resultPath(out)));
}

function flips(before: Result, after: Result): Flip[] {
  const was = new Map(before.cases.map((c) => [c.name, c.arms]));
  return after.cases.flatMap((c) =>
    Object.entries(c.arms).flatMap(([arm, runs]) =>
      runs.flatMap((run, i) => {
        const old = was.get(c.name)?.[arm]?.[i];
        if (old === undefined) return [];
        return diff(old, run).map(([name, passed]) => ({
          grader: `${c.name}/${name}`,
          run: runId(c.name, arm, i),
          passed,
        }));
      }),
    ),
  );
}
