import { globSync, readdirSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { siblingLinks } from "./wrap";

/** Where native suites live, relative to the repo root. */
export const SUITE_GLOBS = ["plugins/*/evals/*", "evals/user/*"];

/** Where `evals/native/run.ts` writes each suite's runs, relative to the repo root. */
export const RESULT_GLOBS = SUITE_GLOBS.map((s) => `${s}/results/*/aggregate-result.json`);

/** Optional `suite.yaml` beside the case directories. */
export const SuiteFile = z.object({
  /** Gated tools the cases need, passed to `--allow-tools`. */
  allow_tools: z.array(z.string()).default([]),
  judge_model: z.string().default("claude-sonnet-5-5"),
  /** Repo-relative paths a scaffold reads, such as `packages/eval-stubs`, staged from the working tree. */
  stage: z.array(z.string()).default([]),
  /** Paths in each run's working directory copied to `<output>/artifacts/<run>/`, for a `score` script. */
  collect: z.array(z.string()).default([]),
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

const PluginManifest = z.object({ dependencies: z.array(z.string()).default([]) });

/**
 * Adds the plugins that repo-relative plugin directories declare as `dependencies`,
 * transitively. A dependency names a sibling plugin directory. The runner loads each case
 * plugin inline and reports one whose dependency is not also inline as `dependency-unsatisfied`,
 * so it never loads.
 */
export async function withDependencies(repo: string, plugins: string[]): Promise<string[]> {
  const seen = new Set<string>();
  let next = plugins;
  while (next.length > 0) {
    const fresh = [...new Set(next)].filter((p) => !seen.has(p));
    for (const p of fresh) seen.add(p);
    // oxlint-disable-next-line no-await-in-loop -- each level's plugins come from the last
    const deps = await Promise.all(fresh.map((p) => dependencies(repo, p)));
    next = deps.flat();
  }
  return [...seen].toSorted();
}

/** Repo-relative directories of the plugins one plugin declares as dependencies. */
async function dependencies(repo: string, plugin: string): Promise<string[]> {
  const manifest = Bun.file(join(repo, plugin, ".claude-plugin/plugin.json"));
  if (!(await manifest.exists())) return [];
  const { dependencies: names } = PluginManifest.parse(await manifest.json());
  return Promise.all(
    names.map(async (name) => {
      const dep = join(dirname(plugin), name);
      if (!(await Bun.file(join(repo, dep, ".claude-plugin/plugin.json")).exists()))
        throw new Error(`${plugin} depends on ${name}, but ${dep} is not a plugin`);
      return dep;
    }),
  );
}

/** Repo-relative plugin directories a case lists, as written in its `case.yaml`. */
export async function listedPlugins(repo: string, suite: string, file: string): Promise<string[]> {
  const { plugins } = CaseFile.parse(parse(await Bun.file(join(repo, suite, file)).text()));
  return plugins.map((p) => normalize(join(suite, dirname(file), p)));
}

/** Repo-relative plugin directories the suite's cases load, with their dependencies. */
export async function casePlugins(repo: string, suite: string): Promise<string[]> {
  const files = globSync("*/case.yaml", { cwd: join(repo, suite) });
  const lists = await Promise.all(files.map((file) => listedPlugins(repo, suite, file)));
  return withDependencies(repo, [...new Set(lists.flat())]);
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

/** Files outside a wrapped skill that it links to, which `wrap.ts` copies in beside it. */
async function skillSiblings(repo: string, skill: string): Promise<string[]> {
  const files = globSync("**/*.md", { cwd: join(repo, skill) });
  const links = await Promise.all(
    files.map(async (f) =>
      siblingLinks(skill, join(skill, f), await Bun.file(join(repo, skill, f)).text()),
    ),
  );
  return links.flat();
}

/** Repo paths a suite's scores depend on: the suite, the plugins its cases load, and what it wraps. */
export async function suiteInputs(repo: string, suite: string): Promise<string[]> {
  const { wrap } = await readSuite(join(repo, suite));
  const wrapped =
    wrap === undefined
      ? []
      : [
          ...wrap.skills,
          ...(await Promise.all(wrap.skills.map((s) => skillSiblings(repo, s)))).flat(),
          ...wrap.agents,
          ...wrap.context,
        ];
  return [...new Set([suite, ...(await casePlugins(repo, suite)), ...wrapped])];
}

const within = (path: string, input: string) => path === input || path.startsWith(`${input}/`);

/** The suites CI may run whose inputs hold any of the changed paths, skipping local-only suites. */
export async function selectSuites(repo: string, changed: string[]): Promise<string[]> {
  const all = findSuites(repo)
    .filter((s) => !s.localOnly)
    .map((s) => s.dir);
  const hit = await Promise.all(
    all.map(async (suite) => {
      const paths = await suiteInputs(repo, suite);
      return changed.some((c) => paths.some((p) => within(c, p)));
    }),
  );
  return all.filter((_, i) => hit[i]);
}
