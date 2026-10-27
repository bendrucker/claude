import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";

const Manifest = z.object({ scripts: z.object({ generate: z.string().optional() }).optional() });

/** Runs a suite's `generate` package script, which writes the cases it keeps out of git. */
export async function generate(suite: string): Promise<void> {
  const file = Bun.file(join(suite, "package.json"));
  if (!(await file.exists())) return;
  if (Manifest.parse(await file.json()).scripts?.generate === undefined) return;
  await $`bun run generate`.cwd(suite).quiet();
}
