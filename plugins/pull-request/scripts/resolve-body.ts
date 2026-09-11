// Where a `gh pr` / `glab mr` command gets its body and title from: heredocs,
// inline flag values, body files, and the `cd`s ahead of them.

import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { literal, parseShell, type ShellCommand, type Word } from "./shell";

type PrCli = "gh" | "glab";

interface PrVerb {
  cli: PrCli;
  /** The words that name the subcommand, e.g. `gh pr create`. */
  argv: string[];
}

// The `if` rules in hooks.json scope dispatch to these four subcommands, and
// the hook repeats the check so it stays inert under any other dispatch.
const PR_VERBS: PrVerb[] = [
  { cli: "gh", argv: ["gh", "pr", "create"] },
  { cli: "gh", argv: ["gh", "pr", "edit"] },
  { cli: "glab", argv: ["glab", "mr", "create"] },
  { cli: "glab", argv: ["glab", "mr", "update"] },
];

const VIEW_VERBS: Record<PrCli, string[]> = {
  gh: ["gh", "pr", "view"],
  glab: ["glab", "mr", "view"],
};

// `-b` is `--body` on gh and `--target-branch` on glab. `-d` is `--description`
// on glab and `--draft` on gh. So the flag sets are keyed by CLI.
const BODY_FLAGS: Record<PrCli, { file: string[]; inline: string[] }> = {
  gh: { file: ["--body-file"], inline: ["--body", "-b"] },
  glab: { file: ["--description-file"], inline: ["--description", "-d"] },
};

const TITLE_FLAGS = ["--title", "-t"];

function startsWith(command: ShellCommand, words: string[]): boolean {
  return words.every((word, index) => literal(command.argv[index]) === word);
}

interface PrInvocation {
  cli: PrCli;
  verb: string[];
  command: ShellCommand;
  /** Commands the shell runs first, which is what can have written a body file. */
  preceding: ShellCommand[];
}

function findPrCommand(command: string): PrInvocation | null {
  const commands = parseShell(command);
  for (const [index, candidate] of commands.entries()) {
    const verb = PR_VERBS.find((entry) => startsWith(candidate, entry.argv));
    if (verb === undefined) continue;
    return {
      cli: verb.cli,
      verb: verb.argv,
      command: candidate,
      preceding: commands.slice(0, index),
    };
  }
  return null;
}

export function isPrBodyCommand(command: string): boolean {
  return findPrCommand(command) !== null;
}

// Splitting on segments rather than text keeps the expansion in `--body="$X"`
// an expansion.
function flagValue(argv: Word[], flags: string[]): Word | undefined {
  for (const [index, word] of argv.entries()) {
    const text = literal(word);
    if (text !== null && flags.includes(text)) return argv[index + 1];
    const first = word.segments[0];
    if (first?.kind !== "literal") continue;
    const flag = flags.find((entry) => first.text.startsWith(`${entry}=`));
    if (flag === undefined) continue;
    const head = { kind: "literal" as const, text: first.text.slice(flag.length + 1) };
    return { source: word.source, segments: [head, ...word.segments.slice(1)] };
  }
  return undefined;
}

export type BodyPart = { kind: "literal"; text: string } | { kind: "file"; path: string };

/** Where a command's body comes from, before any file is read. */
export type BodySpec =
  | { kind: "none" }
  | { kind: "parts"; parts: BodyPart[] }
  | { kind: "unreadable"; detail: string };

function unreadableExpansion(source: string): BodySpec {
  return {
    kind: "unreadable",
    detail: `an inline body holding a shell expansion the hook cannot evaluate (\`${source.trim()}\`)`,
  };
}

// Reading `/dev/stdin` would consume the hook's own (already-drained) stdin and
// validate an empty body.
const STDIN_PATHS = new Set(["-", "/dev/stdin"]);

/** Where a command leaves its stdout: a `>` redirect, or the sink `tee` names. */
function writeTarget(command: ShellCommand): string | null {
  if (command.output !== null) return literal(command.output);
  if (literal(command.argv[0]) !== "tee") return null;
  const sink = command.argv.slice(1).find((word) => !(literal(word) ?? "-").startsWith("-"));
  return sink === undefined ? null : literal(sink);
}

// `> body.md` and `--body-file $PWD/body.md` are the same file, so the match is
// on the name alone. Names that only look alike cost the author a deny, which
// beats a body the hook reports as checked and did not check.
function sameFile(target: string | null, path: string): boolean {
  const name = basename(path);
  return target !== null && name !== "" && basename(target) === name;
}

// The redirect lands on a pipeline's last stage while the content comes from
// its first, so the last write to `path` is followed back to its source.
function lastWriteTo(preceding: ShellCommand[], path: string): ShellCommand | undefined {
  const write = preceding.findLast((command) => sameFile(writeTarget(command), path));
  if (write === undefined) return undefined;
  return preceding.find((command) => command.pipeline === write.pipeline);
}

// The shell leaves the last of several heredocs on the command's stdin.
function heredocSpec(command: ShellCommand): BodySpec {
  const heredoc = command.heredocs.at(-1);
  if (heredoc === undefined) return { kind: "none" };
  const expansion = heredoc.expansions[0];
  if (expansion !== undefined) {
    return {
      kind: "unreadable",
      detail: `an unquoted heredoc holding a shell expansion the hook cannot evaluate (\`${expansion.trim()}\`)`,
    };
  }
  return { kind: "parts", parts: [{ kind: "literal", text: heredoc.content }] };
}

// A PR number, URL, or branch. Null when the command leaves it off and the CLI
// resolves the current branch's PR, which both commands in a round trip do.
function prSelector(command: ShellCommand, verb: string[]): string | null {
  const text = literal(command.argv[verb.length]);
  return text === null || text.startsWith("-") ? null : text;
}

/**
 * Whether the write into the body file read back the PR the command is about to
 * edit. The hook runs before the shell, so that path holds nothing the CLI will
 * send, and every check is skipped: an edit-in-place round trip ships
 * unvalidated. A generator writing the same path still owes a readable body.
 */
function readsBackSamePr(invocation: PrInvocation, write: ShellCommand): boolean {
  const verb = VIEW_VERBS[invocation.cli];
  if (!startsWith(write, verb)) return false;
  return prSelector(write, verb) === prSelector(invocation.command, invocation.verb);
}

// What a path holds by the time the CLI reads it. A body written and passed in
// one call resolves to its heredoc, since the file does not exist yet.
function pathSpec(invocation: PrInvocation, path: string): BodySpec {
  const asFile: BodySpec = { kind: "parts", parts: [{ kind: "file", path }] };
  const write = lastWriteTo(invocation.preceding, path);
  if (write === undefined) return asFile;
  if (readsBackSamePr(invocation, write)) return { kind: "none" };
  const written = heredocSpec(write);
  return written.kind === "none" ? asFile : written;
}

function fileSpec(invocation: PrInvocation, value: Word): BodySpec {
  const path = literal(value);
  if (path === null) return unreadableExpansion(value.source);
  if (STDIN_PATHS.has(path)) {
    const fed = heredocSpec(invocation.command);
    if (fed.kind !== "none") return fed;
    return { kind: "unreadable", detail: `a body piped in on standard input (\`${path}\`)` };
  }
  return pathSpec(invocation, path);
}

function inlineSpec(invocation: PrInvocation, value: Word): BodySpec {
  if (literal(value) === "-") {
    return { kind: "unreadable", detail: "a body typed into an editor (`-`)" };
  }
  const parts: BodyPart[] = [];
  for (const segment of value.segments) {
    if (segment.kind === "unresolved") return unreadableExpansion(segment.source);
    if (segment.kind === "literal") {
      if (segment.text !== "") parts.push({ kind: "literal", text: segment.text });
      continue;
    }
    const held = pathSpec(invocation, segment.path);
    if (held.kind !== "parts") return held;
    parts.push(...held.parts);
  }
  return { kind: "parts", parts };
}

function bodySpec(invocation: PrInvocation): BodySpec {
  const flags = BODY_FLAGS[invocation.cli];
  const fileValue = flagValue(invocation.command.argv, flags.file);
  if (fileValue !== undefined) return fileSpec(invocation, fileValue);
  const inlineValue = flagValue(invocation.command.argv, flags.inline);
  return inlineValue === undefined ? { kind: "none" } : inlineSpec(invocation, inlineValue);
}

export function extractBodySpec(command: string): BodySpec {
  const invocation = findPrCommand(command);
  return invocation === null ? { kind: "none" } : bodySpec(invocation);
}

/** The body text a command will send, or why the hook cannot see it. */
export type BodyResolution =
  | { kind: "none" }
  | {
      kind: "text";
      text: string;
      /** Absolute path the whole body was read from, when a caller may rewrite it. */
      file: string | null;
    }
  | { kind: "unreadable"; detail: string };

async function readBodyFile(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

// A `cd` ahead of the PR command moves where the CLI resolves a relative body
// path. One on the failure side of a `||` runs only when the one before it
// failed, so it is off the path that reaches the PR command.
export function effectiveCwd(command: string, cwd: string): string {
  const invocation = findPrCommand(command);
  let dir = cwd;
  for (const step of invocation?.preceding ?? parseShell(command)) {
    if (step.fallback || literal(step.argv[0]) !== "cd") continue;
    const target = literal(step.argv[1]);
    if (target === null || target === "" || target === "-") continue;
    if (target.startsWith("~")) {
      // `~user` needs a passwd lookup the hook does not do, so leave dir as-is.
      if (target !== "~" && !target.startsWith("~/")) continue;
      dir = join(homedir(), target.slice(1));
      continue;
    }
    dir = isAbsolute(target) ? target : join(dir, target);
  }
  return dir;
}

/**
 * The one file the whole body was read from, when rewriting it would survive to
 * the PR. Null when the body is assembled from more than one source, and null
 * when a command ahead of the PR verb names that file: it would replace the
 * correction, and the hook would report a fix the PR never carried.
 */
function rewritableFile(
  invocation: PrInvocation,
  parts: BodyPart[],
  files: string[],
): string | null {
  const part = parts[0];
  if (parts.length !== 1 || files.length !== 1 || part?.kind !== "file") return null;
  const name = basename(part.path);
  if (name === "") return null;
  const named = invocation.preceding.some(
    (command) =>
      sameFile(writeTarget(command), part.path) ||
      command.argv.some((word) => word.source.includes(name)),
  );
  return named ? null : (files[0] ?? null);
}

export async function resolveBody(command: string, cwd: string): Promise<BodyResolution> {
  const invocation = findPrCommand(command);
  if (invocation === null) return { kind: "none" };
  const spec = bodySpec(invocation);
  if (spec.kind !== "parts") return spec;
  const base = effectiveCwd(command, cwd);
  const chunks: string[] = [];
  const files: string[] = [];
  for (const part of spec.parts) {
    if (part.kind === "literal") {
      chunks.push(part.text);
      continue;
    }
    const path = isAbsolute(part.path) ? part.path : join(base, part.path);
    // oxlint-disable-next-line no-await-in-loop -- returns on the first unreadable part, and a command carries at most a few.
    const text = await readBodyFile(path);
    if (text === null) {
      return {
        kind: "unreadable",
        detail: `body file \`${part.path}\`, which does not exist yet or could not be read`,
      };
    }
    files.push(path);
    chunks.push(text);
  }
  return {
    kind: "text",
    text: chunks.join(""),
    file: rewritableFile(invocation, spec.parts, files),
  };
}

export function extractTitle(command: string): string | null {
  const invocation = findPrCommand(command);
  if (invocation === null) return null;
  const title = literal(flagValue(invocation.command.argv, TITLE_FLAGS));
  return title === null || title === "" ? null : title;
}
