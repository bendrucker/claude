import { $ } from "bun";
import { join } from "node:path";
import parseDiff from "parse-diff";
import type { FileDiff, LineRange } from "./types";

function coalesce(lineNumbers: number[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const n of lineNumbers) {
    const last = ranges.at(-1);
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

/**
 * Files git neither tracks nor ignores, relative to `cwd`. `staged` adds the
 * index too, for an unborn branch with no HEAD to diff.
 */
export async function listUntracked(cwd: string, staged = false): Promise<string[]> {
  const listed = staged
    ? $`git ls-files --cached --others --exclude-standard`
    : $`git ls-files --others --exclude-standard`;
  const result = await listed.cwd(cwd).quiet().nothrow();
  if (result.exitCode !== 0) return [];
  return result
    .text()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** An untracked file is new, so every line it has counts as added. */
async function untrackedDiffs(cwd: string): Promise<FileDiff[]> {
  const paths = await listUntracked(cwd);
  const diffs = await Promise.all(
    paths.map(async (path): Promise<FileDiff | null> => {
      const file = Bun.file(join(cwd, path));
      if (!(await file.exists())) return null;
      const text = await file.text();
      const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      return lines === 0 ? null : { path, added: [{ start: 1, end: lines }] };
    }),
  );
  return diffs.filter((diff) => diff != null);
}

/**
 * The local modes diff against the working tree, where collection reads the
 * new content: `--base` from the merge base, the default from HEAD.
 */
async function captureDiff(options: DiffOptions, cwd: string): Promise<string> {
  if (options.mr != null && options.mr !== "") {
    return (await $`glab mr diff ${options.mr}`.cwd(cwd).quiet().nothrow()).text();
  }
  if (options.base != null && options.base !== "") {
    const mergeBase = (await $`git merge-base HEAD ${options.base}`.cwd(cwd).quiet().nothrow())
      .text()
      .trim();
    const ref = mergeBase !== "" ? mergeBase : options.base;
    return (await $`git diff ${ref}`.cwd(cwd).quiet().nothrow()).text();
  }
  const head = (await $`git diff HEAD`.cwd(cwd).quiet().nothrow()).text();
  if (head.trim() !== "") return head;
  return (await $`git diff --cached`.cwd(cwd).quiet().nothrow()).text();
}

/**
 * Resolve a diff base and parse it into per-file added line ranges. The local
 * modes add untracked files whole.
 */
export async function resolveDiff(
  options: DiffOptions = {},
  cwd: string = process.cwd(),
): Promise<FileDiff[]> {
  const tracked = parseUnifiedDiff(await captureDiff(options, cwd));
  if (options.mr != null && options.mr !== "") return tracked;
  return [...tracked, ...(await untrackedDiffs(cwd))];
}
