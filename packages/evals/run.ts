import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { $ } from "bun";
import { parseDocument } from "yaml";
import { z } from "zod";
import { subscriptionEnv } from "../eval-judge/env";
import { shareGraders } from "./graders";
import { artifactsPath, casePath, listCases, resultPath, tracePath } from "./layout";
import { eachRun, readResult } from "./result";
import { stage } from "./stage";
import { casePlugins, listedPlugins, readSuite, type SuiteFile, withDependencies } from "./suite";
import { wrap } from "./wrap";

export interface Staged {
  target: string;
  evalDir: string;
}

/** Appends each staged case's missing plugin dependencies to its `plugins:` list. */
async function addCaseDependencies(repo: string, suite: string, root: string): Promise<void> {
  const names = await listCases(join(root, suite));
  await Promise.all(
    names.map(async (name) => {
      const listed = await listedPlugins(root, suite, name);
      const missing = (await withDependencies(repo, listed)).filter((p) => !listed.includes(p));
      if (missing.length === 0) return;
      const path = casePath(join(root, suite), name);
      const doc = parseDocument(await Bun.file(path).text());
      for (const p of missing) doc.addIn(["plugins"], relative(join(suite, name), p));
      await Bun.write(path, doc.toString());
    }),
  );
}

const shellQuote = (s: string) => `'${s.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Adds a plugin to each staged case whose hook copies the `collect` paths out of the session's
 * working directory into `$CLAUDE_CONFIG_DIR/collected/`, which the runner keeps.
 */
async function addCollector(evals: string, collect: string[]): Promise<void> {
  if (collect.length === 0) return;
  const copies = collect
    .map(shellQuote)
    .map((q) => `[ ! -e ${q} ] || { mkdir -p "$d"/$(dirname ${q}) && cp -R ${q} "$d"/${q}; }`);
  const command = [`d="$CLAUDE_CONFIG_DIR/collected"`, ...copies, "true"].join("; ");
  const hook = [{ hooks: [{ type: "command", command }] }];
  const names = await listCases(evals);
  await Promise.all(
    names.map(async (name) => {
      const plugin = join(evals, name, "collect");
      await Bun.write(join(plugin, ".claude-plugin/plugin.json"), '{"name":"collect"}');
      await Bun.write(
        join(plugin, "hooks/hooks.json"),
        JSON.stringify({ hooks: { Stop: hook, SessionEnd: hook } }),
      );
      const path = casePath(evals, name);
      const doc = parseDocument(await Bun.file(path).text());
      doc.addIn(["plugins"], "./collect");
      await Bun.write(path, doc.toString());
    }),
  );
}

const Manifest = z.object({
  userConfig: z.record(z.string(), z.object({ default: z.unknown().optional() })).optional(),
});

/**
 * Writes each plugin's userConfig defaults over its `${user_config.KEY}` placeholders, as an
 * install with default options does. The runner leaves them literal. A skill `!` command with
 * one fails its Bash permission check, and the Skill call fails with it.
 */
export async function fillUserConfig(root: string, plugins: string[]): Promise<void> {
  const files = await Promise.all(
    plugins.map(async (p) => {
      const dir = join(root, p);
      const manifest = Manifest.parse(
        JSON.parse(await Bun.file(join(dir, ".claude-plugin/plugin.json")).text()),
      );
      const defaults = Object.entries(manifest.userConfig ?? {}).filter(
        ([, option]) => option.default !== undefined,
      );
      if (defaults.length === 0) return [];
      const paths = await Array.fromAsync(
        new Bun.Glob("{skills,agents,commands}/**/*.md").scan({ cwd: dir }),
      );
      return paths.map((path) => ({ path: join(dir, path), defaults }));
    }),
  );
  await Promise.all(
    files.flat().map(async ({ path, defaults }) => {
      const text = await Bun.file(path).text();
      let filled = text;
      for (const [key, option] of defaults)
        filled = filled.replaceAll(`\${user_config.${key}}`, String(option.default));
      if (filled !== text) await Bun.write(path, filled);
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
  await fillUserConfig(root, plugins);
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
  await addCollector(join(staged.target, staged.evalDir), config.collect);
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
  const cases = await listCases(dir);
  const kept = cases.filter((name) => patterns.some((p) => p.match(name)));
  if (kept.length === 0) throw new Error(`No case matches --case ${globs.join(", ")}`);
  await Promise.all(
    cases.filter((name) => !kept.includes(name)).map(async (name) => $`rm -rf ${join(dir, name)}`),
  );
  return kept;
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
  const path = resultPath(output);
  if (!(await Bun.file(path).exists())) return [];
  const found = await Promise.all(
    [...eachRun(await readResult(path))].map(async ({ case: name, arm, n }) => {
      const trace = Bun.file(tracePath(output, name, arm, n));
      if (!(await trace.exists())) return [];
      for (const line of (await trace.text()).split("\n")) {
        if (line.trim() === "") continue;
        const init = InitEvent.safeParse(JSON.parse(line));
        if (!init.success) continue;
        return (init.data.plugin_errors ?? []).map(
          (e) => `${name}/${arm}/${n}: ${e.plugin} ${e.type}: ${e.message}`,
        );
      }
      return [];
    }),
  );
  return found.flat();
}

/**
 * Command-line arguments given before `--` other than the suite, `--ref`, `--label`, `--adapter`,
 * and help.
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
    if (["--ref", "--label", "--adapter"].includes(arg)) i++;
    else if (/^--(ref|label|adapter)=/.test(arg) || arg === "-h" || arg === "--help") continue;
    else if (!suite && !arg.startsWith("-")) suite = true;
    else stray.push(arg);
  }
  return stray;
}

/** Whether a path exists, as a file or a directory. */
async function exists(path: string): Promise<boolean> {
  return (await $`test -e ${path}`.nothrow().quiet()).exitCode === 0;
}

/**
 * Copies each run's trace into `<output>/traces/<case>-<arm>-<n>.jsonl`, and each `collect` path
 * from its working directory into `<output>/artifacts/<case>-<arm>-<n>/`. The runner writes both
 * inside its temp directories and deletes them unless run with `--keep-temp`, so this copies them
 * out and then removes those directories.
 */
export async function collectTraces(output: string, collect: string[] = []): Promise<void> {
  const path = resultPath(output);
  if (!(await Bun.file(path).exists())) return;
  const copies = [...eachRun(await readResult(path))].map(
    async ({ case: name, arm, n, run: { tracePath: source } }) => {
      if (source == null || !(await Bun.file(source).exists())) return;
      await Bun.write(tracePath(output, name, arm, n), Bun.file(source));
      const out = dirname(source);
      if (basename(out) !== "out") return;
      const kept = dirname(out);
      // The runner deletes the session's working directory, so the collector hook copied them to config.
      await Promise.all(
        collect.map(async (p) => {
          const from = join(kept, "config/collected", p);
          if (!(await exists(from))) return;
          const to = join(artifactsPath(output, name, arm, n), p);
          await $`mkdir -p ${dirname(to)} && cp -R ${from} ${to}`.quiet();
        }),
      );
      // The runner leaves a write-only `sealed` directory that blocks a plain rm.
      await $`chmod -R u+rwx ${kept}/sealed ${kept}; rm -rf ${kept}`.nothrow().quiet();
    },
  );
  await Promise.all(copies);
}
