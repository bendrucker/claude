#!/usr/bin/env bun

import { join } from "node:path";
import { Glob } from "bun";
import { loadPlugins } from "../packages/marketplace/index";

async function getPluginDeps(pluginDir: string): Promise<Set<string>> {
  const deps = new Set<string>();
  const glob = new Glob("**/package.json");

  for await (const path of glob.scan({ cwd: pluginDir })) {
    if (path.includes("node_modules") || path.includes(".bun-cache")) continue;
    try {
      const pkg = await Bun.file(join(pluginDir, path)).json();
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
  return specifier.split("/")[0] as string;
}

async function getImportedPackages(pluginDir: string): Promise<Set<string>> {
  const packages = new Set<string>();
  const glob = new Glob("**/*.ts");

  for await (const path of glob.scan({ cwd: pluginDir })) {
    if (path.includes("node_modules") || path.includes(".bun-cache")) continue;
    if (path.endsWith(".test.ts") || path.endsWith(".integration.ts")) continue;

    const content = await Bun.file(join(pluginDir, path)).text();
    for (const match of content.matchAll(/^import\s+.*?from\s+["']([^"']+)["']/gm)) {
      const specifier = match[1] as string;
      if (specifier.startsWith(".") || isBuiltin(specifier)) continue;
      packages.add(packageName(specifier));
    }
  }

  return packages;
}

let failed = false;

for (const plugin of await loadPlugins()) {
  if (!plugin.dir) continue;

  const declared = await getPluginDeps(plugin.dir);
  const imported = await getImportedPackages(plugin.dir);

  for (const pkg of imported) {
    if (!declared.has(pkg) && !declared.has(`@types/${pkg}`)) {
      console.error(`${plugin.name}: missing dependency "${pkg}"`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
