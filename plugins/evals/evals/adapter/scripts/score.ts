import { join } from "node:path";
import { z } from "zod";
import { artifactsPath } from "../../../../../packages/evals/layout";
import { readResult, type Run, score } from "../../../../../packages/evals/result";
import { GRADERS, stubEnv } from "./check";

const TIMEOUT_MS = 300_000;

const Verdicts = z.record(z.string(), z.object({ passed: z.boolean(), explanation: z.string() }));

const fail = (explanation: string) =>
  Object.fromEntries(GRADERS.map((name) => [name, { passed: false, explanation }]));

// Runs grade one at a time, since concurrent uv and promptfoo installs contend for one cache.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task);
  queue = next.catch(() => undefined);
  return next;
}

/** Runs `check.ts` on one run's artifacts in its own process, failing every grader on a crash. */
async function grade(dir: string, framework: string): Promise<z.output<typeof Verdicts>> {
  if (!(await Bun.file(join(dir, "adapter.ts")).exists())) return fail("no adapter.ts written");
  const proc = Bun.spawn(["bun", join(import.meta.dirname, "check.ts"), dir, framework], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...stubEnv(framework) },
    timeout: TIMEOUT_MS,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) return fail(`check exited ${code}: ${err.trim().split("\n").at(-1) ?? ""}`);
  // An adapter's commands share stdout, so the verdicts are the last line.
  return Verdicts.parse(JSON.parse(out.trim().split("\n").at(-1) ?? ""));
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
            const framework = c.name.split("-")[0] ?? c.name;
            const verdicts = await serial(() =>
              grade(artifactsPath(output, c.name, arm, i), framework),
            );
            const kept = run.graders.filter((g) => !GRADERS.some((name) => name === g.name));
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
