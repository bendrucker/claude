import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CommandResult, Run } from "./exec";
import type { PullRequest } from "./forge";

export interface WorktreeRecord {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
}

/**
 * A detached record carries no `branch` line, so keying rows off `branch` (as
 * the shell original did) drops the worktree from the board entirely.
 */
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: { path: string; head: string | null; branch: string | null; detached: boolean } | null = null;

  const flush = (): void => {
    if (current !== null) records.push(current);
    current = null;
  };

  for (const line of porcelain.split("\n")) {
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      flush();
      current = { path: value, head: null, branch: null, detached: false };
      continue;
    }
    if (current === null) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "bare") current = null;
  }
  flush();

  return records.filter((record) => record.path !== "");
}

export type StatusRead = "clean" | "dirty" | "unreadable";

/**
 * `git status --porcelain` prints nothing both for a clean tree and for a
 * repository it could not read, and a row that reads clean by accident is a
 * removal proposal against work that still exists.
 */
export function readStatus(result: CommandResult): StatusRead {
  if (!result.ok) return "unreadable";
  return result.stdout.split("\0").some((entry) => entry !== "") ? "dirty" : "clean";
}

/**
 * Ignored paths a checkout regenerates. Without this filter the carry flag
 * fires on every worktree holding `node_modules` or a build cache and stops
 * distinguishing anything. Three forms: `name/` matches any path segment,
 * `*suffix` matches the end of a file name, and a bare name matches a file
 * name exactly.
 */
export const CONVENTIONAL_IGNORED: readonly string[] = [
  "node_modules/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "tmp/",
  ".next/",
  ".turbo/",
  ".gradle/",
  ".astro/",
  ".wrangler/",
  ".svelte-kit/",
  ".parcel-cache/",
  ".output/",
  ".source/",
  ".cache/",
  ".prek/",
  ".histoire/",
  ".tox/",
  ".claude/",
  "coverage/",
  ".nyc_output/",
  "htmlcov/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  "*.tsbuildinfo",
  "*-env.d.ts",
  "*.log",
  "coverage.out",
  "lcov.info",
  ".coverage",
];

export function isConventionalIgnored(path: string): boolean {
  const parts = path.replace(/\/+$/, "").split("/");
  const name = parts.at(-1) ?? "";
  return CONVENTIONAL_IGNORED.some((entry) => {
    if (entry.endsWith("/")) return parts.includes(entry.slice(0, -1));
    if (entry.startsWith("*")) return name.endsWith(entry.slice(1));
    return name === entry;
  });
}

export function filterCarried(paths: readonly string[]): string[] {
  return paths.filter((path) => !isConventionalIgnored(path));
}

const CARRY_DEPTH = 3;

async function ignoredUnder(run: Run, root: string, candidates: string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const result = await run(["git", "check-ignore", "-z", "--stdin"], {
    cwd: root,
    stdin: candidates.join("\0"),
  });
  return new Set(result.stdout.split("\0").filter((path) => path !== ""));
}

async function descend(run: Run, root: string, dirs: string[], depth: number): Promise<string[]> {
  if (depth === 0 || dirs.length === 0) return [];

  const listings = await Promise.all(
    dirs.map(async (rel) => {
      try {
        return { rel, entries: await readdir(join(root, rel), { withFileTypes: true }) };
      } catch {
        return { rel, entries: [] };
      }
    }),
  );

  const candidates: string[] = [];
  const directories = new Set<string>();
  for (const { rel, entries } of listings) {
    for (const entry of entries) {
      if (rel === "" && entry.name === ".git") continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      candidates.push(path);
      if (entry.isDirectory()) directories.add(path);
    }
  }

  const ignored = await ignoredUnder(run, root, candidates);
  const carried: string[] = [];
  const next: string[] = [];
  for (const path of candidates) {
    if (ignored.has(path)) carried.push(directories.has(path) ? `${path}/` : path);
    else if (directories.has(path)) next.push(path);
  }

  return [...carried, ...(await descend(run, root, next, depth - 1))];
}

/**
 * `git status --ignored` answers this but walks every ignored tree, which cost
 * ten seconds on a single worktree carrying `node_modules`. Asking
 * `check-ignore` one directory level at a time stops at an ignored directory
 * the same way, for a fraction of the work.
 */
export async function carriedIgnoredPaths(run: Run, worktree: string): Promise<string[]> {
  return filterCarried(await descend(run, worktree, [""], CARRY_DEPTH));
}

export interface FlagInput {
  readonly detached: boolean;
  readonly status: StatusRead;
  readonly ahead: number | null;
  readonly carried: number;
  readonly merged: boolean;
  readonly reused: boolean;
}

export function deriveFlags(input: FlagInput): string[] {
  const flags: string[] = [];
  if (input.detached) flags.push("detached");
  if (input.status !== "clean") flags.push(input.status === "dirty" ? "dirty" : "unreadable");
  if (input.ahead === null) flags.push("unpushed:?");
  else if (input.ahead > 0) flags.push(`unpushed:${input.ahead}`);
  if (input.carried > 0) flags.push(`carries:${input.carried}`);
  if (input.merged) flags.push("merged");
  if (input.reused) flags.push("reused");
  return flags.length === 0 ? ["clean"] : flags;
}

export function ageInDays(commit: number | null, now: number): number | null {
  if (commit === null) return null;
  return Math.floor((now - commit) / 86400);
}

/**
 * `headRefName` is historical text that survives the branch's deletion, so a
 * new branch created under a recycled name joins to the old merged pull
 * request and inherits its disposition.
 */
export function isReusedBranch(pull: PullRequest | undefined, branchCommit: number | null): boolean {
  if (pull === undefined || pull.state !== "merged") return false;
  if (pull.mergedAt === null || branchCommit === null) return false;
  return branchCommit > pull.mergedAt;
}
