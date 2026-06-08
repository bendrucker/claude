#!/usr/bin/env bun

import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import { loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";

// Exit codes: 0 clean, VIOLATION_EXIT when cross-plugin imports are found.
// Anything else (bun exits 1 on uncaught errors) means the checker itself
// failed to run. The Stop hook in .claude/hooks/plugin-imports relies on this
// distinction to avoid reporting a crash as a violation.
export const VIOLATION_EXIT = 2;

const rootDir = join(import.meta.dirname, "..");
const pluginsDir = join(rootDir, "plugins");
const transpiler = new Bun.Transpiler({ loader: "ts" });

async function getPluginDirs(): Promise<string[]> {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args.map((arg) => resolve(arg));
  }

  const plugins = await loadPlugins();
  return plugins.flatMap((p) => (p.dir ? [p.dir] : []));
}

async function checkPlugin(pluginDir: string): Promise<string[]> {
  const violations: string[] = [];
  const pluginName = relative(pluginsDir, pluginDir);
  const glob = new Glob("**/*.ts");

  for await (const path of glob.scan({ cwd: pluginDir })) {
    if (path.includes("node_modules") || path.includes(".bun-cache")) continue;

    const filePath = join(pluginDir, path);
    let content = await Bun.file(filePath).text();
    if (content.startsWith("#!")) {
      const newline = content.indexOf("\n");
      content = newline === -1 ? "" : content.slice(newline + 1);
    }
    const imports = transpiler.scanImports(content);

    for (const imp of imports) {
      if (!imp.path.startsWith(".")) continue;

      const resolved = resolve(dirname(filePath), imp.path);

      if (!resolved.startsWith(`${pluginDir}/`) && resolved !== pluginDir) {
        const target = relative(rootDir, resolved);
        violations.push(
          `${pluginName}: ${path} imports outside plugin boundary: ${imp.path} → ${target}`,
        );
      }
    }
  }

  return violations;
}

async function findViolations(): Promise<string[]> {
  const pluginDirs = await getPluginDirs();
  const results = await Promise.all(pluginDirs.map(checkPlugin));
  return results.flat();
}

if (import.meta.main) {
  await runCheck(findViolations, {
    stream: "stderr",
    indent: false,
    failureExit: VIOLATION_EXIT,
  });
}
