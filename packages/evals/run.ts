import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { $ } from "bun";
import { shareGraders } from "./graders";
import { readResult } from "./result";
import { stage } from "./stage";
import { casePlugins, readSuite, type SuiteFile } from "./suite";
import { wrap } from "./wrap";

export interface Staged {
  target: string;
  evalDir: string;
}

async function stagePlugins(
  repo: string,
  suite: string,
  ref: string | undefined,
  root: string,
): Promise<Staged> {
  const plugins = await casePlugins(repo, suite);
  const owner = plugins.find((p) => !relative(p, suite).startsWith(".."));
  if (owner === undefined)
    throw new Error(`${suite} does not sit inside any plugin its cases load`);
  await stage(repo, ref, plugins, root);
  // The suite always comes from the working tree, so every ref is graded by the same cases.
  await $`rm -rf ${join(root, suite)}`.quiet();
  await stage(repo, undefined, [suite], root);
  await Promise.all(
    plugins.map(async (p) => {
      if (!(await Bun.file(join(root, p, "package-lock.json")).exists())) return;
      await $`npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund --loglevel=error`.cwd(
        join(root, p),
      );
    }),
  );
  return { target: join(root, dirname(owner)), evalDir: relative(dirname(owner), suite) };
}

async function stageWrapped(
  repo: string,
  suite: string,
  ref: string | undefined,
  root: string,
  config: NonNullable<SuiteFile["wrap"]>,
): Promise<Staged> {
  const out = join(root, config.name);
  await wrap({ repo, ref, out, ...config });
  await stage(repo, undefined, [suite], root);
  await $`mv ${join(root, suite)} ${join(out, "evals")}`.quiet();
  return { target: out, evalDir: "evals" };
}

/** Builds the plugin tree a suite runs against, with the artifacts under test read at a ref. */
export async function prepare(
  repo: string,
  suite: string,
  ref: string | undefined,
): Promise<Staged> {
  const root = mkdtempSync(join(tmpdir(), "hill-climb-"));
  const config = await readSuite(join(repo, suite));
  const staged =
    config.wrap === undefined
      ? await stagePlugins(repo, suite, ref, root)
      : await stageWrapped(repo, suite, ref, root, config.wrap);
  await shareGraders(join(staged.target, staged.evalDir), config.graders);
  return staged;
}

/** Splits `--case` globs off the runner's arguments, which would keep only the last one. */
export function splitCases(args: string[]): [cases: string[], rest: string[]] {
  const cases: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg.startsWith("--case=")) cases.push(arg.slice("--case=".length));
    else if (arg === "--case") cases.push(args[++i] ?? "");
    else rest.push(arg);
  }
  return [cases, rest];
}

/** Deletes the staged case directories that don't match any glob, and returns the rest. */
export async function keepCases(dir: string, globs: string[]): Promise<string[]> {
  const patterns = globs.map((g) => new Bun.Glob(g));
  const cases = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && e.name !== "examples" && e.name !== "results",
  );
  const kept = cases.filter((e) => patterns.some((p) => p.match(e.name))).map((e) => e.name);
  if (kept.length === 0) throw new Error(`No case matches --case ${globs.join(", ")}`);
  await Promise.all(
    cases.filter((e) => !kept.includes(e.name)).map(async (e) => $`rm -rf ${join(dir, e.name)}`),
  );
  return kept.toSorted();
}

/**
 * Copies each run's trace into `<output>/traces/<case>-<arm>-<n>.jsonl`. The runner writes
 * traces inside its temp directories and deletes them unless run with `--keep-temp`, so this
 * copies them out and then removes those directories.
 */
export async function collectTraces(output: string): Promise<void> {
  const path = join(output, "aggregate-result.json");
  if (!(await Bun.file(path).exists())) return;
  const { cases } = await readResult(path);
  const copies = cases.flatMap((c) =>
    Object.entries(c.arms).flatMap(([arm, runs]) =>
      runs.map(async ({ tracePath }, i) => {
        if (tracePath == null || !(await Bun.file(tracePath).exists())) return;
        await Bun.write(join(output, "traces", `${c.name}-${arm}-${i}.jsonl`), Bun.file(tracePath));
        const out = dirname(tracePath);
        if (basename(out) !== "out") return;
        // The runner leaves a write-only `sealed` directory that blocks a plain rm.
        const kept = dirname(out);
        await $`chmod -R u+rwx ${kept}/sealed ${kept}; rm -rf ${kept}`.nothrow().quiet();
      }),
    ),
  );
  await Promise.all(copies);
}
