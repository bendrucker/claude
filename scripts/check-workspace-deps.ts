#!/usr/bin/env bun

import { dirname, join } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import { runCheck, tracked } from "./check";

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

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Workspace directories declared by the root package.json, plus the root.
 *
 * Every entry gets its own resolution root under Bun's installer, so a
 * workspace must declare what its own files import. Root is included because
 * repo scripts outside any workspace resolve against it.
 */
export async function workspaceDirs(cwd: string): Promise<string[]> {
  const root = await decodeFile(PackageJson, join(cwd, "package.json"));
  const patterns = root.workspaces ?? [];
  const dirs = await Promise.all(
    patterns.map(async (pattern) => {
      if (!pattern.includes("*")) return [pattern];
      const matches: string[] = [];
      for await (const path of new Glob(`${pattern}/package.json`).scan({ cwd })) {
        matches.push(dirname(path));
      }
      return matches;
    }),
  );
  return [".", ...dirs.flat()];
}

async function declaredPackages(dir: string, cwd: string): Promise<Set<string>> {
  const pkg = await decodeFile(PackageJson, join(cwd, dir, "package.json"));
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:");
}

export function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return `${scope}/${name}`;
  }
  return specifier.split("/")[0] ?? specifier;
}

/**
 * Bare package specifiers imported by a TypeScript source.
 *
 * The `type` keyword is stripped before scanning because `Transpiler.scanImports`
 * elides type-only imports, and a type-only import of an undeclared package
 * still fails to resolve under `oxlint --type-aware`. Only the two forms that
 * carry a module specifier are rewritten: bare `export type Name =` declares a
 * local alias and must survive intact for the source to still parse.
 */
export function importedPackages(source: string): Set<string> {
  const body = source.startsWith("#!") ? source.slice(source.indexOf("\n") + 1) : source;
  const values = body
    .replaceAll(/\bimport\s+type\s+/g, "import ")
    .replaceAll(/\bexport\s+type\s+(?=[{*])/g, "export ");

  const packages = new Set<string>();
  for (const { path } of transpiler.scanImports(values)) {
    if (path.startsWith(".") || path.startsWith("/") || isBuiltin(path)) continue;
    packages.add(packageName(path));
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

async function checkDeps(): Promise<string[]> {
  const cwd = join(import.meta.dirname, "..");
  const dirs = await workspaceDirs(cwd);
  const declared = new Map(
    await Promise.all(dirs.map(async (dir) => [dir, await declaredPackages(dir, cwd)] as const)),
  );

  const files = (await tracked("*.ts", cwd)).filter(
    (file) => !file.endsWith(".d.ts") && !file.split("/").includes("fixtures"),
  );

  const scanned = await Promise.all(
    files.map(async (file) => ({
      file,
      dir: owningWorkspace(file, dirs),
      imported: importedPackages(await Bun.file(join(cwd, file)).text()),
    })),
  );

  // Keyed by workspace and package so a dependency imported by twenty files in
  // one workspace reports once, naming the first file as the place to look.
  const violations = new Map<string, string>();
  for (const { file, dir, imported } of scanned) {
    const packages = declared.get(dir);
    if (packages === undefined) continue;

    for (const pkg of imported) {
      if (packages.has(pkg) || packages.has(`@types/${pkg}`)) continue;
      const key = `${dir}\0${pkg}`;
      if (!violations.has(key)) {
        violations.set(key, `${dir}: missing dependency "${pkg}" (imported by ${file})`);
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
