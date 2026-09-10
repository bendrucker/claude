#!/usr/bin/env bun

// Entity-level context for a PR body: what changed at the function and class
// level, from `sem diff`. An input for the body writer, never a gate, so every
// failure path prints nothing and exits 0.

import { join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";

export const Change = z.looseObject({
  entityId: z.string(),
  changeType: z.string(),
  entityType: z.string(),
  entityName: z.string(),
  oldEntityName: z.string().nullable().optional(),
  filePath: z.string(),
  oldFilePath: z.string().nullable().optional(),
  structuralChange: z.boolean().nullable().optional(),
});

export type Change = z.infer<typeof Change>;

export const SemDiff = z.looseObject({
  changes: z.array(Change),
});

export type SemResult =
  | { kind: "ok"; changes: Change[] }
  | { kind: "missing" }
  | { kind: "failed" };

const STATUS: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  moved: "R",
  reordered: "M",
};

function entityRow(change: Change): string {
  const letter = STATUS[change.changeType] ?? "M";
  const prefix = `${letter} ${change.entityType} `;
  if (letter !== "R") return prefix + change.entityName;

  const movedFrom =
    change.oldFilePath != null && change.oldFilePath !== change.filePath
      ? `${change.oldFilePath}:`
      : "";
  const from = `${movedFrom}${change.oldEntityName ?? change.entityName}`;
  return from === change.entityName
    ? prefix + change.entityName
    : `${prefix}${from} → ${change.entityName}`;
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`;
}

export function render(changes: Change[], options: { base: string }): string {
  const header = `Entities (${options.base}...HEAD`;
  if (changes.length === 0) return `${header}): none`;

  const unparsed = new Set<string>();
  let cosmetic = 0;
  let moduleLevel = 0;
  const byFile = new Map<string, string[]>();

  for (const change of changes) {
    if (change.entityType === "chunk") {
      unparsed.add(change.filePath);
      continue;
    }
    if (change.structuralChange === false) {
      cosmetic += 1;
      continue;
    }
    if (change.entityType === "orphan") {
      moduleLevel += 1;
      continue;
    }
    const rows = byFile.get(change.filePath) ?? [];
    rows.push(entityRow(change));
    byFile.set(change.filePath, rows);
  }

  const counts: string[] = [];
  if (cosmetic > 0) counts.push(`cosmetic-only: ${plural(cosmetic, "entity", "entities")}`);
  if (moduleLevel > 0) counts.push(`module-level: ${moduleLevel}`);
  if (unparsed.size > 0) counts.push(`unparsed: ${plural(unparsed.size, "file", "files")}`);

  const lines = [`${header}, structural only):`];
  if (byFile.size === 0 && cosmetic > 0) {
    lines.push("  cosmetic-only diff");
  }
  for (const [filePath, rows] of byFile) {
    lines.push(`  ${filePath}`);
    for (const row of rows) lines.push(`    ${row}`);
  }
  if (counts.length > 0) lines.push(`  ${counts.join(" · ")}`);

  return lines.join("\n");
}

export interface BaseLookups {
  prBase: () => Promise<string | null>;
  currentBranch: () => Promise<string | null>;
  stackFile: () => Promise<string | null>;
  originHead: () => Promise<string | null>;
}

function depth(line: string): number {
  return line.length - line.replace(/^\t+/, "").length;
}

export function stackParent(stack: string, branch: string): string | null {
  const lines = stack.split("\n");
  const index = lines.findIndex((line) => line.trim() === branch);
  const own = lines[index];
  if (own === undefined) return null;

  const parentDepth = depth(own) - 1;
  if (parentDepth < 0) return null;

  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    if (depth(line) === parentDepth) return line.trim();
  }
  return null;
}

export async function resolveBase(lookups: BaseLookups): Promise<string> {
  const [prBase, branch, stack, originHead] = await Promise.all([
    lookups.prBase(),
    lookups.currentBranch(),
    lookups.stackFile(),
    lookups.originHead(),
  ]);

  if (prBase != null && prBase !== "") return `origin/${prBase}`;

  if (branch != null && branch !== "" && stack != null) {
    const parent = stackParent(stack, branch);
    if (parent != null) return `origin/${parent}`;
  }

  if (originHead != null && originHead !== "") {
    return originHead.replace(/^refs\/remotes\//, "");
  }

  return "origin/main";
}

const TIMEOUT_MS = 15_000;

async function capture(command: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore", timeout: TIMEOUT_MS });
    const stdout = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}

export function gitLookups(): BaseLookups {
  return {
    prBase: () => capture(["gh", "pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"]),
    currentBranch: () => capture(["git", "branch", "--show-current"]),
    stackFile: async () => {
      const commonDir = await capture(["git", "rev-parse", "--git-common-dir"]);
      if (commonDir === null) return null;
      try {
        return await Bun.file(join(commonDir, "wt", "stack")).text();
      } catch {
        return null;
      }
    },
    originHead: () => capture(["git", "symbolic-ref", "refs/remotes/origin/HEAD"]),
  };
}

function isMissingBinary(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    return true;
  }
  return String(error).includes("ENOENT");
}

export async function runSem(ref: string): Promise<SemResult> {
  let stdout: string;
  let exitCode: number;
  try {
    const proc = Bun.spawn(["sem", "diff", ref, "--format", "json"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: TIMEOUT_MS,
      env: { ...process.env, SEM_NO_UPDATE_CHECK: "1", SEM_NO_TELEMETRY: "1" },
    });
    stdout = await new Response(proc.stdout).text();
    exitCode = await proc.exited;
  } catch (error) {
    return isMissingBinary(error) ? { kind: "missing" } : { kind: "failed" };
  }

  if (exitCode !== 0) return { kind: "failed" };

  try {
    return { kind: "ok", changes: SemDiff.parse(JSON.parse(stdout)).changes };
  } catch {
    return { kind: "failed" };
  }
}

async function mergeBase(ref: string): Promise<string | null> {
  return capture(["git", "merge-base", ref, "HEAD"]);
}

async function diffRef(base: string): Promise<string> {
  const remote = await mergeBase(base);
  if (remote !== null) return remote;
  const local = base.replace(/^origin\//, "");
  return (local === base ? null : await mergeBase(local)) ?? base;
}

if (import.meta.main) {
  const argv = cli({
    name: "sem-context",
    help: {
      description: "Print the branch's entity-level changes as context for a PR body.",
    },
    flags: {
      base: {
        type: String,
        description:
          "Base ref to diff against. Default: the PR base, then the worktree stack parent, then the repo default branch.",
      },
    },
  });

  const base = argv.flags.base ?? (await resolveBase(gitLookups()));
  const result = await runSem(await diffRef(base));

  if (result.kind === "missing") {
    console.log("sem: not installed (brew install sem-cli)");
  } else if (result.kind === "ok") {
    console.log(render(result.changes, { base }));
  }
}
