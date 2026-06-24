import { $ } from "bun";
import type { FileDiff, LineRange } from "./types";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

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

function newPath(plusLine: string): string | null {
  const raw = (plusLine.slice(4).split("\t")[0] ?? "").trim();
  if (raw === "/dev/null") return null;
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

/**
 * Parse a unified diff into the added/modified line ranges per file, expressed
 * in the NEW version of each file. Deleted files (`+++ /dev/null`) are skipped.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];

  let path: string | null = null;
  let added: number[] = [];
  let newLine = 0;

  const flush = () => {
    if (path !== null) {
      files.push({ path, added: coalesce(added) });
    }
    path = null;
    added = [];
    newLine = 0;
  };

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      continue;
    }
    if (line.startsWith("+++ ")) {
      flush();
      path = newPath(line);
      continue;
    }
    if (line.startsWith("--- ")) {
      continue;
    }
    const header = line.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (path === null) {
      continue;
    }
    if (line.startsWith("+")) {
      added.push(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      // Removed from the old file: the new-file counter does not advance.
    } else {
      // Context line (leading space) or hunk filler advances the new file.
      newLine += 1;
    }
  }

  flush();
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
