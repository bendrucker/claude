#!/usr/bin/env bun

import { dirname, join } from "node:path";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import { readTracked, runCheck, tracked } from "./check";
import { isBuiltin, packageName, scanImports } from "./imports";

// Exit codes: 0 clean, VIOLATION_EXIT when undeclared dependencies are found.
// Anything else (bun exits 1 on uncaught errors) means the checker itself
// failed to run. The Stop hook in .claude/hooks/workspace-deps relies on this
// distinction to avoid reporting a crash as a violation.
export const VIOLATION_EXIT = 2;

const PackageJson = z.looseObject({
  workspaces: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

type PackageJson = z.infer<typeof PackageJson>;

function declaredPackages(pkg: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

/** Bare package specifiers a TypeScript source imports, keyed to their package. */
export function importedPackages(source: string): Set<string> {
  const packages = new Set<string>();
  for (const specifier of scanImports(source)) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || isBuiltin(specifier)) continue;
    packages.add(packageName(specifier));
  }
  return packages;
}

/** The innermost workspace containing a file, which owns its dependencies. */
export function owningWorkspace(file: string, dirs: string[]): string {
  const owner = dirs
    .filter((dir) => dir !== "." && file.startsWith(`${dir}/`))
    .toSorted((a, b) => b.length - a.length)[0];
  return owner ?? ".";
}

/**
 * Directories holding a package.json that the root does not list as a workspace.
 *
 * Such a directory resolves through the root's hoisted node_modules instead of
 * its own manifest, so every import under it would be checked against the
 * root's declarations and an undeclared one would pass.
 */
export function unlistedWorkspaces(manifests: string[], dirs: string[]): string[] {
  return manifests.map((file) => dirname(file)).filter((dir) => !dirs.includes(dir));
}

async function checkDeps(): Promise<string[]> {
  const cwd = join(import.meta.dirname, "..");
  const [root, manifests, sources] = await Promise.all([
    decodeFile(PackageJson, join(cwd, "package.json")),
    tracked("*package.json", cwd),
    tracked("*.ts", cwd),
  ]);

  const dirs = [".", ...(root.workspaces ?? [])];
  const declared = new Map(
    await Promise.all(
      dirs.map(async (dir) => {
        const pkg =
          dir === "." ? root : await decodeFile(PackageJson, join(cwd, dir, "package.json"));
        return [dir, declaredPackages(pkg)] as const;
      }),
    ),
  );

  const files = sources.filter(
    (file) => !file.endsWith(".d.ts") && !file.split("/").includes("fixtures"),
  );
  const scanned = await Promise.all(
    files.map(async (file) => {
      const source = await readTracked(file, cwd);
      return source === null
        ? null
        : { file, dir: owningWorkspace(file, dirs), imported: importedPackages(source) };
    }),
  );

  // Keyed by workspace and package so a dependency imported by twenty files in
  // one workspace reports once, naming the first file as the place to look.
  const violations = new Map<string, string>();
  for (const dir of unlistedWorkspaces(manifests, dirs)) {
    violations.set(`${dir}\0`, `${dir}: has a package.json but is not a root workspace`);
  }

  for (const scan of scanned) {
    if (scan === null) continue;
    const packages = declared.get(scan.dir);
    if (packages === undefined) continue;

    for (const pkg of scan.imported) {
      if (packages.has(pkg) || packages.has(`@types/${pkg}`)) continue;
      const key = `${scan.dir}\0${pkg}`;
      if (!violations.has(key)) {
        violations.set(key, `${scan.dir}: missing dependency "${pkg}" (imported by ${scan.file})`);
      }
    }
  }

  return [...violations.values()].toSorted();
}

if (import.meta.main) {
  await runCheck(checkDeps, {
    stream: "stderr",
    indent: false,
    failureExit: VIOLATION_EXIT,
  });
}
