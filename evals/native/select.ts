#!/usr/bin/env bun
import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { casePlugins, readSuite } from "./run";

/** Every suite CI may run: a directory of `<case>/case.yaml` without a `.local-only` file. */
export async function suites(repo: string): Promise<string[]> {
  const cases = globSync(["plugins/*/evals/*/*/case.yaml", "evals/user/*/*/case.yaml"], {
    cwd: repo,
  });
  const all = [...new Set(cases.map((c) => dirname(dirname(c))))].toSorted();
  const local = await Promise.all(all.map((s) => Bun.file(join(repo, s, ".local-only")).exists()));
  return all.filter((_, i) => !local[i]);
}

/** Repo paths a suite's scores depend on: the suite, then what it wraps or the plugins its cases load. */
export async function inputs(repo: string, suite: string): Promise<string[]> {
  const { wrap } = await readSuite(join(repo, suite));
  if (wrap !== undefined) return [suite, ...wrap.skills, ...wrap.agents, ...wrap.context];
  return [suite, ...(await casePlugins(repo, suite))];
}

const within = (path: string, input: string) => path === input || path.startsWith(`${input}/`);

/** The suites whose inputs hold any of the changed paths. */
export async function select(repo: string, changed: string[]): Promise<string[]> {
  const all = await suites(repo);
  const hit = await Promise.all(
    all.map(async (suite) => {
      const paths = await inputs(repo, suite);
      return changed.some((c) => paths.some((p) => within(c, p)));
    }),
  );
  return all.filter((_, i) => hit[i]);
}

export const program = new Command("select.ts")
  .description(
    "Print, as a JSON array, the native suites a change touches: a suite runs when a changed path is inside it, inside a plugin its cases load, or inside an artifact its suite.yaml wraps. A suite holding a .local-only file never runs.",
  )
  .argument("[paths...]", "changed repo-relative paths, read one per line from stdin when absent")
  .action(async (paths) => {
    const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
    const changed = paths.length > 0 ? paths : (await Bun.stdin.text()).split("\n").filter(Boolean);
    console.log(JSON.stringify(await select(repo, changed)));
  });

if (import.meta.main) {
  await program.parseAsync();
}
