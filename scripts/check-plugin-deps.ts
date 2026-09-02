#!/usr/bin/env bun

import { join } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import { loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";

// Exit codes: 0 clean, VIOLATION_EXIT when undeclared dependencies are found.
// Anything else (bun exits 1 on uncaught errors) means the checker itself
// failed to run. The Stop hook in .claude/hooks/plugin-deps relies on this
// distinction to avoid reporting a crash as a violation.
export const VIOLATION_EXIT = 2;

const PackageJson = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function getPluginDeps(pluginDir: string): Promise<Set<string>> {
  const deps = new Set<string>();
  const glob = new Glob("**/package.json");

  for await (const path of glob.scan({ cwd: pluginDir })) {
    if (path.includes("node_modules") || path.includes(".bun-cache")) continue;
    if (path.split("/").includes("evals")) continue;
    try {
      const pkg = await decodeFile(PackageJson, join(pluginDir, path));
      for (const field of ["dependencies", "devDependencies"] as const) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
          deps.add(dep);
        }
      }
    } catch {}
  }

  return deps;
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || specifier === "bun";
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0] ?? specifier;
}

async function getImportedPackages(pluginDir: string): Promise<Set<string>> {
  const packages = new Set<string>();
  const glob = new Glob("**/*.ts");

  for await (const path of glob.scan({ cwd: pluginDir })) {
    if (path.includes("node_modules") || path.includes(".bun-cache")) continue;
    if (path.endsWith(".test.ts") || path.endsWith(".integration.ts")) continue;
    // Eval harnesses resolve their deps as repo workspaces, not through the
    // plugin's own package.json.
    if (path.split("/").includes("evals")) continue;

    const content = await Bun.file(join(pluginDir, path)).text();
    for (const match of content.matchAll(/^import\s+.*?from\s+["']([^"']+)["']/gm)) {
      const specifier = match[1];
      if (specifier === undefined || specifier.startsWith(".") || isBuiltin(specifier)) continue;
      packages.add(packageName(specifier));
    }
  }

  return packages;
}

async function checkDeps(): Promise<string[]> {
  const perPlugin = await Promise.all(
    (await loadPlugins()).map(async (plugin) => {
      if (plugin.dir == null || plugin.dir === "") return [];

      const [declared, imported] = await Promise.all([
        getPluginDeps(plugin.dir),
        getImportedPackages(plugin.dir),
      ]);

      return [...imported]
        .filter((pkg) => !declared.has(pkg) && !declared.has(`@types/${pkg}`))
        .map((pkg) => `${plugin.name}: missing dependency "${pkg}"`);
    }),
  );
  const violations = perPlugin.flat();

  return violations;
}

if (import.meta.main) {
  await runCheck(checkDeps, {
    stream: "stderr",
    indent: false,
    failureExit: VIOLATION_EXIT,
  });
}
