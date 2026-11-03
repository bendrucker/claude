import { readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { table } from "table";
import { visit } from "unist-util-visit";
import { SKIPPED_DIRS } from "./imports";
import type { Alert } from "./vale";

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export interface FileScore {
  path: string;
  alerts: number;
  words: number;
}

/** Words of prose in a markdown document, outside frontmatter, code blocks, and HTML. An inline code span counts as one word. */
export function wordCount(text: string): number {
  let count = 0;
  visit(fromMarkdown(text.replace(FRONTMATTER, "")), (node) => {
    if (node.type === "text") count += node.value.match(WORD)?.length ?? 0;
    else if (node.type === "inlineCode") count += 1;
  });
  return count;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(path);
      return entry.isFile() || entry.isSymbolicLink() ? [path] : [];
    }),
  );
  return nested.flat();
}

/** Absolute paths of the files under `paths` that `glob` matches, skipping the directories the scan skips. */
export async function documents(paths: readonly string[], glob: string): Promise<string[]> {
  const matcher = new Bun.Glob(glob);
  const found = await Promise.all(
    paths.map(async (path) => {
      const absolute = resolve(path);
      return (await Bun.file(absolute).exists()) ? [absolute] : walk(absolute);
    }),
  );
  return found.flat().filter((path) => matcher.match(path));
}

/** Alert and word counts for each of `files`, sorted by path. */
export async function scoreFiles(
  files: readonly string[],
  alerts: Map<string, Alert[]>,
): Promise<FileScore[]> {
  const counts = new Map([...alerts].map(([path, found]) => [resolve(path), found.length]));
  const unique = [...new Set([...files, ...counts.keys()].map((path) => resolve(path)))];
  const scores = await Promise.all(
    unique.map(async (path) => ({
      path,
      alerts: counts.get(path) ?? 0,
      words: wordCount(await Bun.file(path).text()),
    })),
  );
  return scores.toSorted((a, b) => a.path.localeCompare(b.path));
}

function density(alerts: number, words: number): string {
  if (words === 0) return alerts === 0 ? "0.00" : "-";
  return ((alerts * 1000) / words).toFixed(2);
}

/** `path` relative to the deepest root holding it, under that root's name when there are several. */
export function rootLabel(path: string, roots: readonly string[]): string {
  const root = roots
    .filter((dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep))
    .toSorted((a, b) => b.length - a.length)[0];
  if (root === undefined) return path;
  const rel = relative(root, path);
  return roots.length > 1 ? join(basename(root), rel) : rel;
}

export function renderScores(scores: readonly FileScore[], roots: readonly string[]): string {
  const rows = scores
    .map((score) => [rootLabel(score.path, roots), score.alerts, score.words] as const)
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([label, alerts, words]) => [
      label,
      String(alerts),
      String(words),
      density(alerts, words),
    ]);
  const alerts = scores.reduce((sum, score) => sum + score.alerts, 0);
  const words = scores.reduce((sum, score) => sum + score.words, 0);
  const total = ["Total", String(alerts), String(words), density(alerts, words)];
  return table([["File", "Alerts", "Words", "Per 1k"], ...rows, total], {
    columns: { 1: { alignment: "right" }, 2: { alignment: "right" }, 3: { alignment: "right" } },
    drawHorizontalLine: (index, size) => index <= 1 || index >= size - 1,
  }).trimEnd();
}
