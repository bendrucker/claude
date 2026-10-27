import { globSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { $ } from "bun";
import { parseDocument } from "yaml";
import { z } from "zod";
import { subscriptionEnv } from "../eval-judge/env";
import { shareGraders } from "./graders";
import { readResult } from "./result";
import { stage } from "./stage";
import { casePlugins, listedPlugins, readSuite, type SuiteFile, withDependencies } from "./suite";
import { wrap } from "./wrap";

export interface Staged {
  target: string;
  evalDir: string;
}

/** Appends each staged case's missing plugin dependencies to its `plugins:` list. */
async function addCaseDependencies(repo: string, suite: string, root: string): Promise<void> {
  const files = globSync("*/case.yaml", { cwd: join(root, suite) });
  await Promise.all(
    files.map(async (file) => {
      const listed = await listedPlugins(root, suite, file);
      const missing = (await withDependencies(repo, listed)).filter((p) => !listed.includes(p));
      if (missing.length === 0) return;
      const path = join(root, suite, file);
      const doc = parseDocument(await Bun.file(path).text());
      for (const p of missing) doc.addIn(["plugins"], relative(join(suite, dirname(file)), p));
      await Bun.write(path, doc.toString());
    }),
  );
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
  await addCaseDependencies(repo, suite, root);
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
  await stage(repo, undefined, config.stage, root);
  await shareGraders(join(staged.target, staged.evalDir), config.graders);
  return staged;
}

/**
 * The environment an eval session runs in. An API key would bill the API instead of the
 * subscription, and a host shell prefix sits outside the eval sandbox, so every Bash call
 * would exit 126.
 */
export function sessionEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const out = subscriptionEnv(env);
  delete out.CLAUDE_CODE_SHELL_PREFIX;
  return out;
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
  const withCase = new Set(globSync("*/case.yaml", { cwd: dir }).map(dirname));
  const cases = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => withCase.has(e.name) && e.name !== "examples" && e.name !== "results",
  );
  const kept = cases.filter((e) => patterns.some((p) => p.match(e.name))).map((e) => e.name);
  if (kept.length === 0) throw new Error(`No case matches --case ${globs.join(", ")}`);
  await Promise.all(
    cases.filter((e) => !kept.includes(e.name)).map(async (e) => $`rm -rf ${join(dir, e.name)}`),
  );
  return kept.toSorted();
}

const InitEvent = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  plugin_errors: z
    .array(z.object({ plugin: z.string(), type: z.string(), message: z.string() }))
    .nullish(),
});

/**
 * Lists every plugin error a collected trace's init event reports, as `<case>/<arm>/<n>`
 * followed by the error. A plugin that fails to load leaves its arm running without it, which
 * the runner otherwise scores without complaint.
 */
export async function pluginErrors(output: string): Promise<string[]> {
  const path = join(output, "aggregate-result.json");
  if (!(await Bun.file(path).exists())) return [];
  const { cases } = await readResult(path);
  const found = await Promise.all(
    cases.flatMap((c) =>
      Object.entries(c.arms).flatMap(([arm, runs]) =>
        runs.map(async (_, i) => {
          const trace = Bun.file(join(output, "traces", `${c.name}-${arm}-${i}.jsonl`));
          if (!(await trace.exists())) return [];
          for (const line of (await trace.text()).split("\n")) {
            if (line.trim() === "") continue;
            const init = InitEvent.safeParse(JSON.parse(line));
            if (!init.success) continue;
            return (init.data.plugin_errors ?? []).map(
              (e) => `${c.name}/${arm}/${i}: ${e.plugin} ${e.type}: ${e.message}`,
            );
          }
          return [];
        }),
      ),
    ),
  );
  return found.flat();
}

/**
 * Command-line arguments given before `--` other than the suite, `--ref`, `--label`, and help.
 * Runner arguments such as `--case` go after `--`, and one before it would be misread as a
 * `run.ts` option or a runner argument.
 */
export function strayArgs(args: string[]): string[] {
  const end = args.indexOf("--");
  const before = end === -1 ? args : args.slice(0, end);
  const stray: string[] = [];
  let suite = false;
  for (let i = 0; i < before.length; i++) {
    const arg = before[i] ?? "";
    if (arg === "--ref" || arg === "--label") i++;
    else if (/^--(ref|label)=/.test(arg) || arg === "-h" || arg === "--help") continue;
    else if (!suite && !arg.startsWith("-")) suite = true;
    else stray.push(arg);
  }
  return stray;
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
