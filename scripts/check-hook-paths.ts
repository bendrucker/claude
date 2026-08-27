#!/usr/bin/env bun

import { root } from "./assets";
import { runCheck, tracked } from "./check";

/**
 * Path prefixes a hook command can name, mapped to the repo-relative directory
 * they deploy from. `~/.claude` is a set of symlinks into `user/`, so a hook
 * command naming a path beneath it is naming a file this repo ships.
 */
const HOME_PREFIXES: Record<string, string> = {
  "~/.claude/": "user/",
  "$HOME/.claude/": "user/",
  "${HOME}/.claude/": "user/",
};

const PROJECT_PREFIXES: Record<string, string> = {
  "$CLAUDE_PROJECT_DIR/": "",
  "${CLAUDE_PROJECT_DIR}/": "",
};

/**
 * Installed by the plugin system into the cache under `~/.claude/plugins`,
 * which this repo does not check out.
 */
const UNMANAGED = ["user/plugins/"];

export interface Source {
  /** Repo-relative settings file. */
  file: string;
  prefixes: Record<string, string>;
}

export const USER_SETTINGS: Source = { file: "user/settings.json", prefixes: HOME_PREFIXES };

/**
 * `$CLAUDE_PROJECT_DIR` expands to whatever repository the session runs in, so
 * it resolves against this checkout only for the project settings file.
 */
export const PROJECT_SETTINGS: Source = {
  file: ".claude/settings.json",
  prefixes: { ...HOME_PREFIXES, ...PROJECT_PREFIXES },
};

export const SOURCES: Source[] = [USER_SETTINGS, PROJECT_SETTINGS];

function quoteRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shell syntax that cannot appear inside an unquoted or quoted path. */
const PATH_BODY = `[^\\s"';|&)]+`;

/**
 * Whether the path starting at `at` is the value of an assignment, as in
 * `PREK_HOME="$CLAUDE_PROJECT_DIR/.prek" bun ...`. An assigned path is data the
 * command passes along rather than code it runs, and often names a directory
 * the tool creates on first use.
 */
function assigned(command: string, at: number): boolean {
  return command.slice(0, at).replace(/["']$/, "").endsWith("=");
}

/**
 * Repo-relative paths a hook command runs.
 *
 * Matching on the prefix rather than parsing the command covers every shape a
 * hook command takes: a bare path, a path passed to an interpreter (`bun
 * <path>`), and a path nested inside a `sh -c` string. Paths carrying no
 * recognized prefix are machine-local (a Homebrew binary, another tool's
 * install dir) and unverifiable from a checkout, so they are left alone.
 */
export function paths(command: string, prefixes: Record<string, string>): string[] {
  const alternation = Object.keys(prefixes).map(quoteRegex).join("|");
  const pattern = new RegExp(`(${alternation})(${PATH_BODY})`, "g");

  return [...command.matchAll(pattern)]
    .filter((match) => !assigned(command, match.index))
    .map(([, prefix, rest]) => `${prefixes[prefix as string]}${rest}`)
    .filter((path) => !UNMANAGED.some((prefix) => path.startsWith(prefix)));
}

interface Settings {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
}

export interface Reference {
  file: string;
  event: string;
  command: string;
  /** Repo-relative path the command names. */
  path: string;
}

/** Every repo path named by a hook command in one settings file, across all events. */
export function references(settings: Settings, source: Source): Reference[] {
  const found: Reference[] = [];

  for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of entries) {
      for (const { command } of entry.hooks ?? []) {
        if (!command) continue;
        for (const path of paths(command, source.prefixes)) {
          found.push({ file: source.file, event, command, path });
        }
      }
    }
  }

  return found;
}

/**
 * Repo-relative paths of every tracked file and of every directory holding one.
 *
 * Tracked rather than present on disk: an imperative installer that writes into
 * `~/.claude/hooks` lands in this directory through the symlink, so the file
 * exists locally while a fresh clone gets nothing.
 */
export async function shipped(): Promise<Set<string>> {
  const found = new Set<string>();

  for (const file of await tracked(".", root)) {
    found.add(file);
    for (let at = file.indexOf("/"); at !== -1; at = file.indexOf("/", at + 1)) {
      found.add(file.slice(0, at));
    }
  }

  return found;
}

export function violations(refs: Reference[], shippedPaths: Set<string>): string[] {
  return refs
    .filter((reference) => !shippedPaths.has(reference.path))
    .map((reference) => `${reference.file} ${reference.event}: ${reference.path}`);
}

export async function load(): Promise<Reference[]> {
  const settings = await Promise.all(
    SOURCES.map(
      async (source) => [source, await Bun.file(`${root}/${source.file}`).json()] as const,
    ),
  );
  return settings.flatMap(([source, file]) => references(file as Settings, source));
}

if (import.meta.main) {
  await runCheck(
    async () => {
      const [refs, files] = await Promise.all([load(), shipped()]);
      return {
        header: "Hook commands naming paths this repo does not ship:",
        violations: violations(refs, files),
      };
    },
    { success: "Every hook command resolves to a tracked path" },
  );
}
