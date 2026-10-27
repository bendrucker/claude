import { join, resolve } from "node:path";
import { $ } from "bun";
import { z } from "zod";

const Manifest = z.object({ scripts: z.object({ score: z.string().optional() }).optional() });

/**
 * Runs a suite's `score` package script on a results directory, for graders that execute what
 * the sessions wrote. The script rewrites `aggregate-result.json` in place.
 */
export async function scoreSuite(suite: string, output: string): Promise<void> {
  const file = Bun.file(join(suite, "package.json"));
  if (!(await file.exists())) return;
  if (Manifest.parse(await file.json()).scripts?.score === undefined) return;
  await $`bun run --silent score ${resolve(output)}`.cwd(suite);
}
