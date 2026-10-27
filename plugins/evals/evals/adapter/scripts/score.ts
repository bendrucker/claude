import { join } from "node:path";
import { z } from "zod";
import { readResult, type Run, score } from "../../../../../packages/evals/result";

const TIMEOUT_MS = 60_000;
const GRADERS = ["loads"];

const Verdicts = z.record(z.string(), z.object({ passed: z.boolean(), explanation: z.string() }));

/** Runs `check.ts` on one run's artifacts in its own process, failing every grader on a crash. */
async function grade(dir: string): Promise<z.output<typeof Verdicts>> {
  const fail = (explanation: string) =>
    Object.fromEntries(GRADERS.map((name) => [name, { passed: false, explanation }]));
  if (!(await Bun.file(join(dir, "adapter.ts")).exists())) return fail("no adapter.ts written");
  const proc = Bun.spawn(["bun", join(import.meta.dirname, "check.ts"), dir], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: TIMEOUT_MS,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) return fail(`check exited ${code}: ${err.trim().split("\n").at(-1) ?? ""}`);
  return Verdicts.parse(JSON.parse(out));
}

const [output] = process.argv.slice(2);
if (output === undefined) throw new Error("usage: score.ts <results dir>");
const path = join(output, "aggregate-result.json");
const result = await readResult(path);
const cases = await Promise.all(
  result.cases.map(async (c) => {
    const arms = await Promise.all(
      Object.entries(c.arms).map(async ([arm, runs]) => {
        const graded = await Promise.all(
          runs.map(async (run, i): Promise<Run> => {
            const verdicts = await grade(join(output, "artifacts", `${c.name}-${arm}-${i}`));
            const kept = run.graders.filter((g) => !GRADERS.includes(g.name));
            const added = Object.entries(verdicts).map(([name, { passed, explanation }]) => ({
              name,
              passed,
              explanation,
              weight: 1,
              scored: true,
              withOnly: true,
            }));
            const next = { ...run, graders: [...kept, ...added] };
            return { ...next, score: score(next, arm) };
          }),
        );
        return [arm, graded] as const;
      }),
    );
    return { ...c, arms: Object.fromEntries(arms) };
  }),
);
await Bun.write(path, JSON.stringify({ ...result, cases }, null, 2));
