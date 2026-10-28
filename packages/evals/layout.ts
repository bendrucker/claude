import { globSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/** The fields of a `<suite>/<case>/case.yaml` that this package reads. */
export const CaseFile = z.looseObject({
  plugins: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type CaseFile = z.output<typeof CaseFile>;

/** Suite subdirectories that hold examples and run output, never cases. */
const RESERVED_DIRS = new Set(["examples", "results"]);

/** Names of a suite's cases: its child directories holding a `case.yaml`, sorted. */
export async function listCases(suite: string): Promise<string[]> {
  const dirs = readdirSync(suite, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && !RESERVED_DIRS.has(e.name),
  );
  const held = await Promise.all(
    dirs.map(async ({ name }) => Bun.file(casePath(suite, name)).exists()),
  );
  return dirs
    .filter((_, i) => held[i])
    .map((d) => d.name)
    .toSorted();
}

export function casePath(suite: string, name: string): string {
  return join(suite, name, "case.yaml");
}

export async function readCase(suite: string, name: string): Promise<CaseFile> {
  return CaseFile.parse(parse(await Bun.file(casePath(suite, name)).text()) ?? {});
}

/** The stem a run's trace and artifacts directory share: `<case>-<arm>-<n>`. */
export function runId(name: string, arm: string, n: number): string {
  return `${name}-${arm}-${n}`;
}

export interface RunRef {
  case: string;
  arm: string;
  n: number;
}

/** Splits a run id, or a trace filename, into its parts. An arm never contains `-`. */
export function parseRunId(stem: string): RunRef | undefined {
  const match = /^(.+)-([^-]+)-(\d+)(?:\.jsonl)?$/.exec(stem);
  if (match === null) return undefined;
  const [, name = "", arm = "", n = ""] = match;
  return { case: name, arm, n: Number(n) };
}

export const RESULT_FILE = "aggregate-result.json";

export const RESULT_GLOB = `results/*/${RESULT_FILE}`;

export function resultPath(dir: string): string {
  return join(dir, RESULT_FILE);
}

/** Where a post-scorer writes its result. */
export function scoredDir(results: string): string {
  return join(results, "scored");
}

export function tracesDir(results: string): string {
  return join(results, "traces");
}

export function artifactsDir(results: string): string {
  return join(results, "artifacts");
}

export function tracePath(results: string, name: string, arm: string, n: number): string {
  return join(tracesDir(results), `${runId(name, arm, n)}.jsonl`);
}

export function artifactsPath(results: string, name: string, arm: string, n: number): string {
  return join(artifactsDir(results), runId(name, arm, n));
}

/** Every trace in a results directory, in case, arm, and run order. */
export function listTraces(results: string): (RunRef & { path: string })[] {
  return globSync("*.jsonl", { cwd: tracesDir(results) })
    .flatMap((file) => {
      const ref = parseRunId(file);
      return ref === undefined ? [] : [{ ...ref, path: join(tracesDir(results), file) }];
    })
    .toSorted((x, y) => {
      const byCase = x.case.localeCompare(y.case);
      if (byCase !== 0) return byCase;
      const byArm = x.arm.localeCompare(y.arm);
      return byArm !== 0 ? byArm : x.n - y.n;
    });
}

/** A suite's name: `<plugin>/<suite>` under `plugins/`, or `user/<suite>` under `evals/user/`. */
export function suiteName(dir: string): string {
  const match = /(?:^|\/)(?:plugins\/([^/]+)\/evals|evals\/(user))\/([^/]+)\/?$/.exec(dir);
  if (match === null) throw new Error(`${dir} is not a suite directory`);
  const [, plugin, user, suite] = match;
  return `${plugin ?? user}/${suite}`;
}

/** Splits `<suite dir>/results/<run>/aggregate-result.json` into its suite name and run. */
export function parseResultPath(path: string): { suite: string; run: string } {
  const dir = dirname(path);
  return { suite: suiteName(dirname(dirname(dir))), run: basename(dir) };
}
