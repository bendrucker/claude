#!/usr/bin/env bun

import { cli } from "cleye";
import { z } from "zod";

const changeSchema = z.object({
  entityId: z.string(),
  changeType: z.enum(["added", "modified", "deleted", "renamed", "moved", "reordered"]),
  entityType: z.string(),
  entityName: z.string(),
  oldEntityName: z.string().nullable(),
  filePath: z.string(),
  oldFilePath: z.string().nullable(),
  structuralChange: z.boolean().nullable(),
});

const diffSchema = z.object({ changes: z.array(changeSchema) });

export type Change = z.infer<typeof changeSchema>;

const letters: Record<Change["changeType"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  moved: "V",
  reordered: "O",
};

interface Partitioned {
  files: Map<string, Change[]>;
  cosmetic: number;
  moduleLevel: number;
  unparsed: Set<string>;
}

// Unparsed files arrive as one `chunk` row per 20 lines and `orphan` marks a
// module-level edit, neither of which names an entity worth a row.
function partition(changes: Change[]): Partitioned {
  const partitioned: Partitioned = {
    files: new Map(),
    cosmetic: 0,
    moduleLevel: 0,
    unparsed: new Set(),
  };

  for (const change of changes) {
    if (change.entityType === "chunk") {
      partitioned.unparsed.add(change.filePath);
    } else if (change.structuralChange === false) {
      partitioned.cosmetic += 1;
    } else if (change.entityType === "orphan") {
      partitioned.moduleLevel += 1;
    } else {
      const rows = partitioned.files.get(change.filePath) ?? [];
      rows.push(change);
      partitioned.files.set(change.filePath, rows);
    }
  }

  return partitioned;
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function tally(partitioned: Partitioned): string | null {
  const parts = [
    partitioned.cosmetic === 0
      ? null
      : `cosmetic-only: ${count(partitioned.cosmetic, "entity", "entities")}`,
    partitioned.moduleLevel === 0 ? null : `module-level: ${partitioned.moduleLevel}`,
    partitioned.unparsed.size === 0
      ? null
      : `unparsed: ${count(partitioned.unparsed.size, "file", "files")}`,
  ].filter((part) => part !== null);

  return parts.length === 0 ? null : parts.join(" · ");
}

function row(change: Change): string {
  const name =
    change.oldEntityName === null
      ? change.entityName
      : `${change.oldEntityName} → ${change.entityName}`;
  const origin = change.oldFilePath === null ? "" : ` (from ${change.oldFilePath})`;
  return `${letters[change.changeType]} ${change.entityType} ${name}${origin}`;
}

function section(file: string, changes: Change[]): string[] {
  const lines = [`  ${file}`];
  for (const change of changes) lines.push(`    ${row(change)}`);
  return lines;
}

export function render(changes: Change[], label: string): string {
  const header = `Entities (${label}, structural only):`;
  if (changes.length === 0) return `${header}\n  no entity changes`;

  const partitioned = partition(changes);
  const body = [...partitioned.files]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([file, rows]) => section(file, rows));
  const trailer =
    partitioned.cosmetic === changes.length ? "cosmetic-only diff" : tally(partitioned);

  return [header, ...body, ...(trailer === null ? [] : [`  ${trailer}`])].join("\n");
}

export type SemResult = { ok: true; stdout: string } | { ok: false; reason: "missing" | "failed" };

export type RunSem = (args: string[]) => Promise<SemResult>;

export type MergeBase = (base: string) => Promise<string | null>;

export interface Sources {
  runSem: RunSem;
  mergeBase: MergeBase;
}

function missingBinary(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export const runSem: RunSem = async (args) => {
  try {
    const proc = Bun.spawn(["sem", ...args], {
      env: { ...process.env, SEM_NO_UPDATE_CHECK: "1", SEM_NO_TELEMETRY: "1" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? { ok: true, stdout } : { ok: false, reason: "failed" };
  } catch (error) {
    return { ok: false, reason: missingBinary(error) ? "missing" : "failed" };
  }
};

export const mergeBase: MergeBase = async (base) => {
  try {
    const proc = Bun.spawn(["git", "merge-base", base, "HEAD"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
};

export type Target = { base: string } | { range: string };

function parseDiff(stdout: string): Change[] | null {
  try {
    const parsed = diffSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data.changes : null;
  } catch {
    return null;
  }
}

// The block is an input to the review, never a gate, so every failure other
// than a missing binary leaves it out silently.
export async function scopeBlock(
  target: Target,
  sources: Sources = { runSem, mergeBase },
): Promise<string> {
  const ref = "base" in target ? await sources.mergeBase(target.base) : target.range;
  if (ref === null || ref === "") return "";

  const result = await sources.runSem(["diff", ref, "--format", "json"]);
  if (!result.ok) {
    return result.reason === "missing" ? "sem: not installed (brew install sem-cli)" : "";
  }

  const changes = parseDiff(result.stdout);
  if (changes === null) return "";

  return render(changes, "base" in target ? `${target.base}...HEAD` : target.range);
}

if (import.meta.main) {
  const argv = cli({
    name: "sem-scope",
    strictFlags: true,
    help: {
      description: "Print the entity-level scope block for a review range, from sem diff.",
    },
    flags: {
      base: {
        type: String,
        description: "Diff the merge-base of this ref and HEAD against the working tree",
      },
      range: { type: String, description: "Diff an explicit range, e.g. main...feature" },
    },
  });

  const { base, range } = argv.flags;
  const target: Target | null =
    base !== undefined && range === undefined
      ? { base }
      : range !== undefined && base === undefined
        ? { range }
        : null;

  if (target === null) {
    console.error("Pass exactly one of --base <ref> or --range <a>...<b>.");
    process.exit(1);
  }

  const block = await scopeBlock(target);
  if (block !== "") console.log(block);
}
