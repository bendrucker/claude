import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// https://code.claude.com/docs/en/memory#import-additional-files
export const MAX_HOPS = 4;

// The memory files whose `@path` imports Claude Code expands.
export const IMPORTERS = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]);

const SKIPPED_DIRS = new Set(["node_modules", ".git", "fixtures", "__snapshots__", "evals"]);

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;

export interface Unscanned {
  from: string;
  path: string;
  reason: "outside the scanned paths" | "missing";
}

function* outsideFences(text: string): Generator<string> {
  let fence: string | undefined;
  let run: string[] = [];
  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (marker === undefined) {
        run.push(line);
        continue;
      }
      yield run.join("\n");
      run = [];
      fence = marker;
    } else if (marker?.startsWith(fence) && line.trim() === marker) {
      fence = undefined;
    }
  }
  yield run.join("\n");
}

/** The `@path` imports in a markdown document, in order, with escaped spaces unescaped. */
export function importPaths(text: string): string[] {
  const paths: string[] = [];
  for (const prose of outsideFences(text)) {
    for (const match of prose.replaceAll(CODE_SPAN, " ").matchAll(IMPORT)) {
      paths.push((match[1] ?? "").replaceAll(String.raw`\ `, " "));
    }
  }
  return paths;
}

export function resolveImport(path: string, from: string): string {
  if (path === "~" || path.startsWith("~/")) return join(homedir(), path.slice(1));
  return isAbsolute(path) ? path : resolve(dirname(from), path);
}

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The directory each scanned path covers, so a named file covers its siblings. */
export async function scanRoots(paths: readonly string[]): Promise<string[]> {
  return Promise.all(
    paths.map(async (path) => {
      const absolute = resolve(path);
      return (await Bun.file(absolute).exists()) ? dirname(absolute) : absolute;
    }),
  );
}

async function importersUnder(path: string, accept: (name: string) => boolean): Promise<string[]> {
  if (await Bun.file(path).exists()) {
    const name = basename(path);
    return IMPORTERS.has(name) && accept(name) ? [path] : [];
  }
  const glob = new Bun.Glob(`**/{${[...IMPORTERS].join(",")}}`);
  return [...glob.scanSync({ cwd: path, dot: true, onlyFiles: true })]
    .filter((rel) => accept(basename(rel)) && !rel.split(sep).some((dir) => SKIPPED_DIRS.has(dir)))
    .map((rel) => join(path, rel));
}

/** Memory files under `paths` whose imports Claude Code expands. */
export async function importers(
  paths: readonly string[],
  accept: (name: string) => boolean,
): Promise<string[]> {
  const found = await Promise.all(paths.map((path) => importersUnder(resolve(path), accept)));
  return found.flat();
}

async function importsOf(
  from: string,
  roots: readonly string[],
): Promise<{ from: string; path: string; target: string; reason?: Unscanned["reason"] }[]> {
  const paths = importPaths(await Bun.file(from).text());
  return Promise.all(
    paths.map(async (path) => {
      const target = resolveImport(path, from);
      if (!roots.some((root) => inside(target, root)))
        return { from, path, target, reason: "outside the scanned paths" as const };
      if (!(await Bun.file(target).exists()))
        return { from, path, target, reason: "missing" as const };
      return { from, path, target };
    }),
  );
}

/**
 * Files the `sources` import, directly or through other imports up to
 * `maxHops` deep, that resolve inside `roots`. Each target appears once, and
 * an import outside the roots or of a missing file lands in `unscanned`.
 */
export async function followImports(
  sources: readonly string[],
  roots: readonly string[],
  maxHops = MAX_HOPS,
): Promise<{ targets: string[]; unscanned: Unscanned[] }> {
  const seen = new Set(sources.map((source) => resolve(source)));
  const targets: string[] = [];
  const unscanned: Unscanned[] = [];
  let frontier = [...seen];
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    // oxlint-disable-next-line no-await-in-loop -- each hop reads the files the last one found
    const found = await Promise.all(frontier.map((from) => importsOf(from, roots)));
    frontier = [];
    for (const { from, path, target, reason } of found.flat()) {
      if (seen.has(target)) continue;
      if (reason !== undefined) {
        unscanned.push({ from, path, reason });
        continue;
      }
      seen.add(target);
      targets.push(target);
      frontier.push(target);
    }
  }
  return { targets, unscanned };
}
