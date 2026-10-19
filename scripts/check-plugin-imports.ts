#!/usr/bin/env bun

import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import { loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";
import { scanImports } from "./imports";

// Exit codes: 0 clean, VIOLATION_EXIT when cross-plugin imports are found.
// Anything else (bun exits 1 on uncaught errors) means the checker itself
// failed to run.
const VIOLATION_EXIT = 2;

const rootDir = join(import.meta.dirname, "..");
const pluginsDir = join(rootDir, "plugins");

/** Plugin-relative paths of the files given under one plugin, or all of its sources. */
async function sources(pluginDir: string, files: string[] | undefined): Promise<string[]> {
  const paths =
    files ?? (await Array.fromAsync(new Glob("**/*.{ts,tsx}").scan({ cwd: pluginDir })));
  return paths.filter(
    (path) =>
      !path.includes("node_modules") &&
      !path.includes(".bun-cache") &&
      // Eval harnesses only ever run from the repo checkout, so they may
      // import packages/ like any other repo script.
      !path.split("/").includes("evals"),
  );
}

async function checkPlugin(pluginDir: string, files?: string[]): Promise<string[]> {
  const violations: string[] = [];
  const pluginName = relative(pluginsDir, pluginDir);

  const read = await Promise.all(
    (await sources(pluginDir, files)).map(async (path) => ({
      path,
      text: await Bun.file(join(pluginDir, path))
        .text()
        .catch(() => null),
    })),
  );

  for (const { path, text } of read) {
    if (text === null) continue;
    const filePath = join(pluginDir, path);

    for (const specifier of scanImports(text, path.endsWith(".tsx") ? "tsx" : "ts")) {
      if (!specifier.startsWith(".")) continue;

      const resolved = resolve(dirname(filePath), specifier);

      if (!resolved.startsWith(`${pluginDir}/`) && resolved !== pluginDir) {
        const target = relative(rootDir, resolved);
        violations.push(
          `${pluginName}: ${path} imports outside plugin boundary: ${specifier} → ${target}`,
        );
      }
    }
  }

  return violations;
}

/** Checks the source files given, or every plugin's sources. */
export async function findViolations(files: string[] = []): Promise<string[]> {
  if (files.length === 0) {
    const plugins = await loadPlugins();
    const dirs = plugins.flatMap((p) => (p.dir != null && p.dir !== "" ? [p.dir] : []));
    return (await Promise.all(dirs.map((dir) => checkPlugin(dir)))).flat();
  }

  const byPlugin = Map.groupBy(
    files.flatMap((file) => {
      const [name, ...rest] = relative(pluginsDir, resolve(rootDir, file)).split("/");
      return name === undefined || name === ".." || rest.length === 0
        ? []
        : [{ dir: join(pluginsDir, name), path: rest.join("/") }];
    }),
    ({ dir }) => dir,
  );
  const results = await Promise.all(
    [...byPlugin].map(([dir, entries]) =>
      checkPlugin(
        dir,
        entries.map(({ path }) => path),
      ),
    ),
  );
  return results.flat();
}

if (import.meta.main) {
  await runCheck(() => findViolations(process.argv.slice(2)), {
    stream: "stderr",
    indent: false,
    failureExit: VIOLATION_EXIT,
  });
}
