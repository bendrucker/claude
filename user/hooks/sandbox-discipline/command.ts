import { basename } from "node:path";

const SHELL_OPERATORS = /\s*(?:&&|\|\||[|;\n])\s*/;
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * Builtins that carry no sandbox exposure of their own. Counting them as verbs would let
 * any two commands that share a `set -e` preamble look like the same command.
 */
const PREAMBLE_VERBS = new Set(["cd", "set", "export", "source", ".", "echo", "true", ":"]);

/** Characters that, inside the git portion of a `cd && git` command, mean the rewrite is not exact. */
const UNSAFE_IN_GIT_ARGS = /[;|&<>`\n]/;

const CD_GIT = /^\s*cd\s+('[^']*'|"[^"]*"|[^\s;&|<>()]+)\s*&&\s*git\s+(\S.*?)\s*$/;

export function splitSegments(command: string): string[] {
  return command
    .split(SHELL_OPERATORS)
    .map((segment) =>
      segment
        .trim()
        .replace(/^[()]+|[()]+$/g, "")
        .trim(),
    )
    .filter(Boolean);
}

/** A segment's tokens with its leading `VAR=value` assignments dropped. */
export function commandTokens(segment: string): string[] {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i] as string)) i++;
  return tokens.slice(i);
}

/**
 * The command word a segment ultimately runs, with `cd`, `export`, and env-assignment
 * preamble dropped and any directory prefix stripped, so `FOO=1 /usr/local/bin/bun a.ts`
 * reduces to `bun`.
 */
export function segmentVerb(segment: string): string | null {
  const [token] = commandTokens(segment);
  if (!token || token.startsWith("-")) return null;
  if (PREAMBLE_VERBS.has(token)) return null;
  return basename(token);
}

/** Insertion-ordered, so the first entry is the first verb the command runs. */
export function commandVerbs(command: string): Set<string> {
  const verbs = new Set<string>();
  for (const segment of splitSegments(command)) {
    const verb = segmentVerb(segment);
    if (verb) verbs.add(verb);
  }
  return verbs;
}

/**
 * What a message about this command should call it: its first real verb, falling back to
 * its leading word when every segment is preamble. Always a name, so a caller can report
 * on any non-empty command.
 */
export function describeVerb(command: string, verbs: Set<string>): string {
  for (const verb of verbs) return verb;
  const [token] = commandTokens(splitSegments(command)[0] ?? command.trim());
  return token ? basename(token) : command.trim();
}

export function sharesVerb(a: Set<string>, b: Set<string>): boolean {
  for (const verb of a) {
    if (b.has(verb)) return true;
  }
  return false;
}

/**
 * Rewrites `cd <dir> && git <rest>` to `git -C <dir> <rest>`, which keeps `git` as the
 * top-level command so the sandbox's `excludedCommands` exemption still applies. Returns
 * null unless the transformation is exact: one `cd`, one `git`, no redirects, no further
 * commands, and a directory that cannot be mistaken for a flag.
 */
export function rewriteCdGit(command: string): string | null {
  const match = command.match(CD_GIT);
  if (!match) return null;

  const [, dir, rest] = match as [string, string, string];
  if (dir.startsWith("-")) return null;
  if (UNSAFE_IN_GIT_ARGS.test(rest)) return null;

  return `git -C ${dir} ${rest}`;
}
