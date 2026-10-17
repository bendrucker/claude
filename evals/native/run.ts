#!/usr/bin/env bun
import { globSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { parse, parseDocument } from "yaml";
import { z } from "zod";
import { subscriptionEnv } from "../../packages/eval-judge/env";
import { erroredRuns } from "./load";
import { shareGraders } from "./shared-graders";
import { stage } from "./stage";
import { wrap } from "./wrap";

/** Optional `suite.yaml` beside the case directories. */
export const SuiteFile = z.object({
  /** Gated tools the cases need, passed to `--allow-tools`. */
  allow_tools: z.array(z.string()).default([]),
  judge_model: z.string().default("claude-sonnet-5-5"),
  /** Repo-relative paths a scaffold reads, such as `packages/eval-stubs`, staged from the working tree. */
  stage: z.array(z.string()).default([]),
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

const CaseFile = z.object({ plugins: z.array(z.string()).default([]) });

const PluginManifest = z.object({ dependencies: z.array(z.string()).default([]) });

const Result = z.object({
  cases: z.array(
    z.object({
      name: z.string(),
      arms: z.record(z.string(), z.array(z.object({ tracePath: z.string().nullish() }))),
    }),
  ),
});

export async function readSuite(dir: string): Promise<z.output<typeof SuiteFile>> {
  const file = Bun.file(join(dir, "suite.yaml"));
  return SuiteFile.parse((await file.exists()) ? parse(await file.text()) : {});
}

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
async function listedPlugins(repo: string, suite: string, file: string): Promise<string[]> {
  const { plugins } = CaseFile.parse(parse(await Bun.file(join(repo, suite, file)).text()));
  return plugins.map((p) => normalize(join(suite, dirname(file), p)));
}

/** Repo-relative plugin directories the suite's cases load, with their dependencies. */
export async function casePlugins(repo: string, suite: string): Promise<string[]> {
  const files = globSync("*/case.yaml", { cwd: join(repo, suite) });
  const lists = await Promise.all(files.map((file) => listedPlugins(repo, suite, file)));
  return withDependencies(repo, [...new Set(lists.flat())]);
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

interface Staged {
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

async function stageWrapped(
  repo: string,
  suite: string,
  ref: string | undefined,
  root: string,
  config: NonNullable<z.output<typeof SuiteFile>["wrap"]>,
): Promise<Staged> {
  const out = join(root, config.name);
  await wrap({ repo, ref, out, ...config });
  await stage(repo, undefined, [suite], root);
  await $`mv ${join(root, suite)} ${join(out, "evals")}`.quiet();
  return { target: out, evalDir: "evals" };
}

/**
 * Copies each run's trace into `<output>/traces/<case>-<arm>-<n>.jsonl`. The runner writes
 * traces inside its temp directories and deletes them unless run with `--keep-temp`, so this
 * copies them out and then removes those directories.
 */
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

/** Deletes the staged case directories that match none of the globs, and returns the rest. */
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

/** How many cases a run graded, zero when it wrote no result. */
export async function caseCount(output: string): Promise<number> {
  const file = Bun.file(join(output, "aggregate-result.json"));
  if (!(await file.exists())) return 0;
  return Result.parse(await file.json()).cases.length;
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
  const file = Bun.file(join(output, "aggregate-result.json"));
  if (!(await file.exists())) return [];
  const { cases } = Result.parse(await file.json());
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
 * Arguments given before `--`, which cleye would otherwise drop or misread. Only `--ref` and
 * `--label` belong there; runner arguments such as `--case` go after `--`.
 */
export function strayArgs(
  positionals: string[],
  passthrough: string[],
  unknownFlags: Record<string, unknown>,
): string[] {
  const extra = positionals.slice(1, positionals.length - passthrough.length);
  return [...Object.keys(unknownFlags).map((f) => `--${f}`), ...extra];
}

export async function collectTraces(output: string): Promise<void> {
  const file = Bun.file(join(output, "aggregate-result.json"));
  if (!(await file.exists())) return;
  const { cases } = Result.parse(await file.json());
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

if (import.meta.main) {
  const argv = cli({
    name: "run.ts",
    parameters: ["<suite>", "--", "[args...]"],
    flags: {
      ref: {
        type: String,
        description: "Git ref to read the skill or plugin at; the working tree when absent",
      },
      label: { type: String, description: "Suffix for the results directory name" },
    },
    help: {
      description:
        "Run a claude plugin eval suite against the artifacts it tests as they stand at a ref. Arguments after -- pass through to claude plugin eval.",
    },
  });
  const stray = strayArgs(argv._, argv._["--"], argv.unknownFlags);
  if (stray.length > 0) {
    console.error(
      `Unknown arguments before --: ${stray.join(" ")}. Runner arguments go after --, as in: run.ts <suite> -- --case <glob>`,
    );
    process.exit(2);
  }
  const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
  const suite = relative(repo, resolve(argv._.suite));
  const config = await readSuite(join(repo, suite));
  const [globs, args] = splitCases(argv._.args);
  const { target, evalDir } = await prepare(repo, suite, argv.flags.ref);
  if (globs.length > 0) await keepCases(join(target, evalDir), globs);
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
  const label = argv.flags.label ?? argv.flags.ref?.replaceAll("/", "-");
  const output = join(repo, suite, "results", label === undefined ? stamp : `${stamp}-${label}`);
  const allow = config.allow_tools.length > 0 ? ["--allow-tools", ...config.allow_tools] : [];

  // An API key in the environment would bill the API instead of the subscription.
  const env = subscriptionEnv();
  const proc = Bun.spawn(
    [
      "claude",
      "plugin",
      "eval",
      target,
      "--eval-dir",
      evalDir,
      "--scaffold",
      "--trust-plugin",
      "--judge-model",
      config.judge_model,
      "--output-dir",
      output,
      "--keep-temp",
      ...allow,
      ...args,
    ],
    { env, stdio: ["inherit", "inherit", "inherit"] },
  );
  const code = await proc.exited;
  await collectTraces(output);
  await $`rm -rf ${dirname(target)}`.quiet();
  // A --case or --tag that matches nothing otherwise exits clean with nothing graded.
  if (code === 0 && (await caseCount(output)) === 0) {
    console.error(`No case ran. Check the case filters in: ${argv._.args.join(" ")}`);
    process.exit(1);
  }
  const loadErrors = await pluginErrors(output);
  if (loadErrors.length > 0) {
    console.error(
      `${loadErrors.length} plugin errors at session start, so those arms ran without the plugin:`,
    );
    for (const e of loadErrors) console.error(`  ${e}`);
    process.exit(1);
  }
  const result = join(output, "aggregate-result.json");
  const errors = (await Bun.file(result).exists()) ? await erroredRuns(result) : [];
  if (errors.length > 0) {
    console.error(`${errors.length} runs errored, and compare.ts leaves them out:`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  process.exit(code);
}
