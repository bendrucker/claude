import { globSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { $ } from "bun";
import { stringify } from "yaml";

/** Serializes a generated `case.yaml`. */
export function serializeCase(file: Record<string, unknown>): string {
  return stringify(file, { lineWidth: 0 });
}

/**
 * Writes generated case files, keyed by path relative to the suite, and removes the stale
 * files and case directories under `<prefix>*`. Concurrent test files each generate a suite,
 * so nothing another run is reading is removed, and each changed file is swapped in by rename.
 */
export async function writeCases(
  suite: string,
  files: Record<string, string>,
  { prefix }: { prefix: string },
): Promise<{ written: string[]; removed: string[] }> {
  const names = new Set(Object.keys(files).map((f) => f.split(/[\\/]/)[0]));
  const removed = [
    ...globSync(`${prefix}*`, { cwd: suite }).filter((d) => !names.has(d)),
    ...globSync(`${prefix}*/**/*`, { cwd: suite, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => relative(suite, join(d.parentPath, d.name)).split(sep).join("/"))
      .filter((f) => !(f in files) && !f.endsWith(".tmp")),
  ];
  await Promise.all(removed.map((f) => rm(join(suite, f), { recursive: true, force: true })));
  const changed = await Promise.all(
    Object.entries(files).map(async ([f, text]) => {
      const path = join(suite, f);
      const file = Bun.file(path);
      if ((await file.exists()) && (await file.text()) === text) return undefined;
      const tmp = `${path}.${process.pid}.tmp`;
      await Bun.write(tmp, text);
      await $`mv ${tmp} ${path}`;
      return f;
    }),
  );
  return { written: changed.filter((f) => f !== undefined), removed };
}
