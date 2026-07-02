import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { type FileCoverage, merge, parseLcov } from "./lcov";

export const repoRoot = join(import.meta.dirname, "..", "..");

// Normalize an input path to a repo-relative POSIX path so scope matching is
// stable whether the caller passes an absolute or relative path.
function toRepoRelative(file: string): string {
  const abs = isAbsolute(file) ? file : join(process.cwd(), file);
  return relative(repoRoot, abs);
}

function hasTests(dir: string): boolean {
  try {
    return readdirSync(dir).some((entry) => entry.endsWith(".test.ts"));
  } catch {
    return false;
  }
}

function nearestTestDir(relFile: string): string {
  let dir = dirname(relFile);
  while (dir && dir !== "." && dir !== "..") {
    if (hasTests(join(repoRoot, dir))) return `./${dir}`;
    dir = dirname(dir);
  }
  return "./";
}

// Map a source file to the test scope that exercises it. Each plugin and package
// is a self-contained scope; `.claude` and `user` are their own roots.
export function resolveScope(file: string): string {
  const rel = toRepoRelative(file);

  const plugin = rel.match(/^(plugins\/[^/]+)\//);
  if (plugin) return `${plugin[1]}/`;

  const pkg = rel.match(/^(packages\/[^/]+)\//);
  if (pkg) return `${pkg[1]}/`;

  if (rel.startsWith(".claude/")) return "./.claude";
  if (rel.startsWith("user/")) return "./user";

  return nearestTestDir(rel);
}

export function resolveScopes(files: string[]): string[] {
  return [...new Set(files.map(resolveScope))];
}

function runScope(scope: string): Promise<FileCoverage[]> {
  const coverageDir = mkdtempSync(join(tmpdir(), "cov-"));
  return new Promise((resolve) => {
    const child = spawn("bun", ["test", "--coverage", `--coverage-dir=${coverageDir}`, scope], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    child.on("close", async () => {
      const lcov = Bun.file(join(coverageDir, "lcov.info"));
      if (!(await lcov.exists())) {
        resolve([]);
        return;
      }
      resolve(parseLcov(await lcov.text()));
    });
    child.on("error", () => resolve([]));
  });
}

// Run Bun coverage for every scope the target files belong to, then merge.
// With no files, measure the default scope set (the repo's test roots).
export async function runCoverage(files: string[]): Promise<FileCoverage[]> {
  const scopes = files.length ? resolveScopes(files) : DEFAULT_SCOPES;
  const reports = await Promise.all(scopes.map(runScope));
  return merge(...reports);
}

export const DEFAULT_SCOPES = ["./.claude", "./user", "packages/"];
