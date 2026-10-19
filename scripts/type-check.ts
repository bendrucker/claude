#!/usr/bin/env bun

import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * Mods whose plugin has no engine declarations yet. A mod type-checks against
 * what `bun run mod-types` writes into its plugin, so one without them would
 * fail on the missing `claude-code` module rather than on anything in the diff.
 */
export async function untypedMods(root = ROOT): Promise<string[]> {
  const mods = await Array.fromAsync(
    new Bun.Glob("plugins/*/mod").scan({ cwd: root, onlyFiles: false }),
  );
  const typed = await Promise.all(
    mods.map((mod) =>
      Bun.file(join(root, dirname(mod), ".claude-plugin/types/claude-code/index.d.ts")).exists(),
    ),
  );
  return mods.filter((_, index) => !typed[index]).toSorted();
}

/**
 * The lint and type check behind the commit gate, over the files given or the
 * whole tree. Type errors a change causes in a file it did not touch surface
 * only in CI, which runs it over the whole tree. --quiet drops
 * warnings, which run to dozens of lines a commit did not cause and never fail
 * it. --no-error-on-unmatched-pattern covers a tree whose config ignores
 * everything in it.
 */
export async function typeCheckArgs(files: string[] = [], root = ROOT): Promise<string[]> {
  const skipped = await untypedMods(root);
  return [
    "--quiet",
    "--no-error-on-unmatched-pattern",
    ...skipped.flatMap((mod) => ["--ignore-pattern", `${mod}/**`]),
    ...files,
  ];
}

if (import.meta.main) {
  const proc = Bun.spawn(
    ["bun", "run", "--silent", "build", ...(await typeCheckArgs(process.argv.slice(2)))],
    {
      cwd: ROOT,
      stdio: ["inherit", "inherit", "inherit"],
    },
  );
  process.exit(await proc.exited);
}
