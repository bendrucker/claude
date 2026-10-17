import { globSync, readdirSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/** Where native suites live, relative to the repo root. */
export const SUITE_GLOBS = ["plugins/*/evals/*", "evals/user/*"];

/** Where `evals/native/run.ts` writes each suite's runs, relative to the repo root. */
export const RESULT_GLOBS = SUITE_GLOBS.map((s) => `${s}/results/*/aggregate-result.json`);

/** Optional `suite.yaml` beside the case directories. */
export const SuiteFile = z.object({
  /** Gated tools the cases need, passed to `--allow-tools`. */
  allow_tools: z.array(z.string()).default([]),
  judge_model: z.string().default("claude-sonnet-5-5"),
  /** Artifacts that are not a plugin, wrapped into one by `wrap.ts`. */
  wrap: z
    .object({
      name: z.string().default("user"),
      skills: z.array(z.string()).default([]),
      agents: z.array(z.string()).default([]),
      context: z.array(z.string()).default([]),
    })
    .optional(),
  /** Graders in `<suite>/graders/`, each mapped to the case-name globs it joins. */
  graders: z
    .record(
      z.string(),
      z.union([z.string(), z.array(z.string())]).transform((v) => [v].flat()),
    )
    .default({}),
});
export type SuiteFile = z.output<typeof SuiteFile>;

const CaseFile = z.object({
  plugins: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export async function readSuite(dir: string): Promise<SuiteFile> {
  const file = Bun.file(join(dir, "suite.yaml"));
  return SuiteFile.parse((await file.exists()) ? parse(await file.text()) : {});
}

/** Repo-relative plugin directories the suite's cases load. */
export async function casePlugins(repo: string, suite: string): Promise<string[]> {
  const files = globSync("*/case.yaml", { cwd: join(repo, suite) });
  const lists = await Promise.all(
    files.map(async (file) => {
      const { plugins } = CaseFile.parse(parse(await Bun.file(join(repo, suite, file)).text()));
      return plugins.map((p) => normalize(join(suite, dirname(file), p)));
    }),
  );
  return [...new Set(lists.flat())].toSorted();
}

/** Maps each case in a suite directory to the tags its case.yaml declares. */
export async function loadTags(suite: string): Promise<Map<string, string[]>> {
  const cases = readdirSync(suite, { withFileTypes: true }).filter((e) => e.isDirectory());
  const entries = await Promise.all(
    cases.map(async ({ name }) => {
      const file = Bun.file(join(suite, name, "case.yaml"));
      if (!(await file.exists())) return undefined;
      return [name, CaseFile.parse(parse(await file.text())).tags] as const;
    }),
  );
  return new Map(entries.filter((e) => e !== undefined));
}

export interface Suite {
  /** Repo-relative suite directory. */
  dir: string;
  /** Whether a `.local-only` file keeps the suite out of CI, as for a corpus-derived suite. */
  localOnly: boolean;
}

/** Every native suite under a repo root: a directory holding a `<case>/case.yaml`, sorted. */
export function findSuites(root: string): Suite[] {
  const base = resolve(root);
  const dirs = SUITE_GLOBS.flatMap((g) => globSync(`${g}/*/case.yaml`, { cwd: base })).map((file) =>
    dirname(dirname(file)),
  );
  return [...new Set(dirs)].toSorted().map((dir) => ({
    dir,
    localOnly: globSync(".local-only", { cwd: join(base, dir) }).length > 0,
  }));
}

/**
 * Every native run's `aggregate-result.json` under a repo root, sorted. A `-regraded`
 * directory from `regrade.ts` carries its source run's cost, so it is left out.
 */
export function resultFiles(root: string): string[] {
  const base = resolve(root);
  return RESULT_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: base }))
    .filter((path) => !path.endsWith("-regraded/aggregate-result.json"))
    .map((path) => join(base, path))
    .toSorted();
}
