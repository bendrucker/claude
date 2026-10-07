import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";

/** Grader name to the case-name globs it joins, as `suite.yaml` declares them. */
export type SharedGraders = Record<string, string[]>;

/** The suite-level graders whose globs match a case name. */
export function sharedFor(shared: SharedGraders, name: string): string[] {
  return Object.entries(shared)
    .filter(([, globs]) => globs.some((g) => new Bun.Glob(g).match(name)))
    .map(([grader]) => grader);
}

/**
 * Copies each grader in `<suite>/graders/` into every case its globs match, unless the case
 * holds a grader by that name, then removes `<suite>/graders/` so the runner never reads it as
 * a case.
 */
export async function shareGraders(suite: string, shared: SharedGraders): Promise<void> {
  const cases = globSync("*/case.yaml", { cwd: suite }).map(dirname);
  const copies = cases.flatMap((name) =>
    sharedFor(shared, name).map(async (grader) => {
      const dest = Bun.file(join(suite, name, "graders", `${grader}.md`));
      if (await dest.exists()) return;
      const source = Bun.file(join(suite, "graders", `${grader}.md`));
      if (!(await source.exists())) throw new Error(`suite.yaml names a missing grader: ${grader}`);
      await Bun.write(dest, await source.text());
    }),
  );
  await Promise.all(copies);
  await $`rm -rf ${join(suite, "graders")}`.quiet();
}
