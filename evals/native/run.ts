#!/usr/bin/env bun
import { globSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { parse } from "yaml";
import { z } from "zod";
import { stage } from "./stage";
import { wrap } from "./wrap";

/** Optional `suite.yaml` beside the case directories. */
export const SuiteFile = z.object({
  /** Gated tools the cases need, passed to `--allow-tools`. */
  allow_tools: z.array(z.string()).default([]),
  judge_model: z.string().default("claude-sonnet-5"),
  /** Artifacts that are not a plugin, wrapped into one by `wrap.ts`. */
  wrap: z
    .object({
      name: z.string().default("user"),
      skills: z.array(z.string()).default([]),
      agents: z.array(z.string()).default([]),
      context: z.array(z.string()).default([]),
    })
    .optional(),
});

const CaseFile = z.object({ plugins: z.array(z.string()).default([]) });

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

interface Staged {
  target: string;
  evalDir: string;
}

async function stagePlugins(repo: string, suite: string, ref: string | undefined, root: string) {
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

/** Builds the plugin tree a suite runs against, with the artifacts under test read at a ref. */
export async function prepare(
  repo: string,
  suite: string,
  ref: string | undefined,
): Promise<Staged> {
  const root = mkdtempSync(join(tmpdir(), "hill-climb-"));
  const config = await readSuite(join(repo, suite));
  if (config.wrap === undefined) return stagePlugins(repo, suite, ref, root);
  const out = join(root, config.wrap.name);
  await wrap({ repo, ref, out, ...config.wrap });
  await stage(repo, undefined, [suite], root);
  await $`mv ${join(root, suite)} ${join(out, "evals")}`.quiet();
  return { target: out, evalDir: "evals" };
}

/**
 * Copies each run's trace into `<output>/traces/<case>-<arm>-<n>.jsonl`. The runner writes
 * traces inside its temp directories and deletes them unless run with `--keep-temp`, so this
 * copies them out and then removes those directories.
 */
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
  const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
  const suite = relative(repo, resolve(argv._.suite));
  const config = await readSuite(join(repo, suite));
  const { target, evalDir } = await prepare(repo, suite, argv.flags.ref);
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
  const label = argv.flags.label ?? argv.flags.ref?.replaceAll("/", "-");
  const output = join(repo, suite, "results", label === undefined ? stamp : `${stamp}-${label}`);
  const allow = config.allow_tools.length > 0 ? ["--allow-tools", ...config.allow_tools] : [];

  // An API key in the environment would bill the API instead of the subscription.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
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
      ...argv._.args,
    ],
    { env, stdio: ["inherit", "inherit", "inherit"] },
  );
  const code = await proc.exited;
  await collectTraces(output);
  await $`rm -rf ${dirname(target)}`.quiet();
  process.exit(code);
}
