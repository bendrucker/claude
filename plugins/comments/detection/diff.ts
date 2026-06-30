import { $ } from "bun";
import parseDiff from "parse-diff";
import type { FileDiff, LineRange } from "./types";

function coalesce(lineNumbers: number[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const n of lineNumbers) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.end + 1) {
      last.end = n;
    } else {
      ranges.push({ start: n, end: n });
    }
  }
  return ranges;
}

/** The new-file path from a `+++` header, with the `b/` prefix and any timestamp dropped. */
function newPath(to: string | undefined): string | null {
  const raw = (to?.split("\t")[0] ?? "").trim();
  if (raw === "" || raw === "/dev/null") return null;
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

/**
 * Parse a unified diff into the added/modified line ranges per file, expressed
 * in the NEW version of each file. Deleted files (`+++ /dev/null`) are skipped.
 * `parse-diff` does the hunk arithmetic. An `add` change carries its new-file
 * line number directly.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  for (const file of parseDiff(diffText)) {
    const path = newPath(file.to);
    if (path === null) continue;
    const added = file.chunks.flatMap((chunk) =>
      chunk.changes.filter((change) => change.type === "add").map((change) => change.ln),
    );
    files.push({ path, added: coalesce(added) });
  }
  return files;
}

export interface DiffOptions {
  base?: string;
  mr?: string;
}

async function captureDiff(options: DiffOptions): Promise<string> {
  if (options.mr) {
    return (await $`glab mr diff ${options.mr}`.quiet().nothrow()).text();
  }
  if (options.base) {
    const mergeBase = (await $`git merge-base HEAD ${options.base}`.quiet().nothrow())
      .text()
      .trim();
    const ref = mergeBase || options.base;
    return (await $`git diff ${ref}..HEAD`.quiet().nothrow()).text();
  }
  const head = (await $`git diff HEAD`.quiet().nothrow()).text();
  if (head.trim()) return head;
  return (await $`git diff --cached`.quiet().nothrow()).text();
}

/** Resolve a diff base and parse it into per-file added line ranges. */
export async function resolveDiff(options: DiffOptions = {}): Promise<FileDiff[]> {
  return parseUnifiedDiff(await captureDiff(options));
}
