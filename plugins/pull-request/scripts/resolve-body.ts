// Where a `gh pr` / `glab mr` command gets its body and title from: heredocs,
// inline flag values, body files, and the `cd`s ahead of them.

import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { literal, parseShell, type ShellCommand, type Span, type Word } from "./shell";

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

/** The PR command a shell line runs, as in `gh pr create`. */
export function prVerb(command: string): string | null {
  return findPrCommand(command)?.verb.join(" ") ?? null;
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

export type BodyPart =
  | { kind: "literal"; text: string }
  /** `writer` is the earlier command in the call that leaves the file as the CLI reads it. */
  | { kind: "file"; path: string; writer?: string }
  /** A same-call heredoc: no file backs it yet, but its span in the command can be spliced. */
  | { kind: "heredoc"; text: string; span: Span; dash: boolean };

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

// What an earlier command does to the body file. `stdout` points at the first
// stage of the pipeline, since the redirect lands on the last stage while the
// content comes from the first.
type Write =
  | { kind: "stdout"; head: ShellCommand }
  | { kind: "copy"; from: string; preceding: ShellCommand[] }
  | { kind: "edit"; command: ShellCommand; preceding: ShellCommand[] };

const IN_PLACE_FLAG: Record<string, RegExp> = {
  sed: /^(-[a-zA-Z]*i|--in-place)/,
  gsed: /^(-[a-zA-Z]*i|--in-place)/,
  perl: /^-[a-z]*i/,
};

// Operands of a command that takes no option values, or null when one of them
// is an expansion.
function operands(command: ShellCommand): string[] | null {
  const texts: string[] = [];
  for (const word of command.argv.slice(1)) {
    const text = literal(word);
    if (text === null) return null;
    if (!text.startsWith("-")) texts.push(text);
  }
  return texts;
}

function soleOperand(command: ShellCommand): string | null {
  const found = operands(command);
  return command.heredocs.length === 0 && found?.length === 1 ? (found[0] ?? null) : null;
}

// `cp`, `mv`, and `cat src > dst` leave the body file holding their one
// source. An in-place editor leaves it holding text the hook cannot know until
// the edit runs.
function writeOf(preceding: ShellCommand[], index: number, path: string): Write | null {
  const command = preceding[index];
  if (command === undefined) return null;
  const name = literal(command.argv[0]) ?? "";
  if (sameFile(writeTarget(command), path)) {
    const head = preceding.find((stage) => stage.pipeline === command.pipeline) ?? command;
    const from = head === command && name === "cat" ? soleOperand(command) : null;
    if (from === null) return { kind: "stdout", head };
    return { kind: "copy", from, preceding: preceding.slice(0, index) };
  }
  const args = command.argv.slice(1).map((word) => literal(word) ?? "");
  if (name === "cp" || name === "mv") {
    const [from, to, ...rest] = operands(command) ?? [];
    if (from === undefined || to === undefined || rest.length > 0 || !sameFile(to, path)) {
      return null;
    }
    return { kind: "copy", from, preceding: preceding.slice(0, index) };
  }
  const flag = IN_PLACE_FLAG[name];
  const edits =
    flag !== undefined &&
    args.some((arg) => flag.test(arg)) &&
    args.some((arg) => sameFile(arg, path));
  return edits ? { kind: "edit", command, preceding: preceding.slice(0, index) } : null;
}

function lastWriteTo(preceding: ShellCommand[], path: string): Write | null {
  for (let index = preceding.length - 1; index >= 0; index--) {
    const write = writeOf(preceding, index, path);
    if (write !== null) return write;
  }
  return null;
}

function fileWrittenBy(path: string, command: ShellCommand): BodySpec {
  const writer = command.argv.map((word) => word.source).join(" ");
  return { kind: "parts", parts: [{ kind: "file", path, writer }] };
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
  return {
    kind: "parts",
    parts: [{ kind: "heredoc", text: heredoc.content, span: heredoc.span, dash: heredoc.dash }],
  };
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
// one call resolves to its heredoc or its copy's source, since the file does
// not exist yet. Any other write leaves the file as it stands now, the best
// guess the hook has before the shell runs.
function pathSpec(invocation: PrInvocation, preceding: ShellCommand[], path: string): BodySpec {
  const write = lastWriteTo(preceding, path);
  if (write === null) return { kind: "parts", parts: [{ kind: "file", path }] };
  if (write.kind === "copy") return pathSpec(invocation, write.preceding, write.from);
  // Editing a PR's own body after reading it back is still a round trip.
  if (write.kind === "edit") {
    const before = pathSpec(invocation, write.preceding, path);
    return before.kind === "none" ? before : fileWrittenBy(path, write.command);
  }
  if (readsBackSamePr(invocation, write.head)) return { kind: "none" };
  const written = heredocSpec(write.head);
  return written.kind === "none" ? fileWrittenBy(path, write.head) : written;
}

function fileSpec(invocation: PrInvocation, value: Word): BodySpec {
  const path = literal(value);
  if (path === null) return unreadableExpansion(value.source);
  if (STDIN_PATHS.has(path)) {
    const fed = heredocSpec(invocation.command);
    if (fed.kind !== "none") return fed;
    return { kind: "unreadable", detail: `a body piped in on standard input (\`${path}\`)` };
  }
  return pathSpec(invocation, invocation.preceding, path);
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
    const held = pathSpec(invocation, invocation.preceding, segment.path);
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
      /** Span the whole body was read from, when a caller may splice a correction in. */
      heredoc: { span: Span } | null;
    }
  | { kind: "unreadable"; detail: string };

// The hook's own TMPDIR differs from the sandbox a `gh`/`glab` call actually
// runs under, which writes to `/tmp/claude-<uid>` instead.
function tmpdirCandidates(path: string): string[] {
  const hookTmpdir = process.env.TMPDIR;
  if (hookTmpdir === undefined || hookTmpdir === "" || !path.startsWith(hookTmpdir)) return [path];
  const uid = process.getuid?.() ?? 0;
  const sandboxed = `/tmp/claude-${uid}${path.slice(hookTmpdir.length)}`;
  return [...new Set([path, sandboxed])];
}

interface ReadCandidate {
  path: string;
  text: string;
  mtimeMs: number;
}

// A read failure of any kind leaves this candidate with nothing to offer. The
// other candidate may still be readable, and `Promise.all` in the caller would
// otherwise let one candidate's rejection deny a command over a body the other
// candidate held fine.
async function readCandidate(path: string): Promise<ReadCandidate | null> {
  try {
    const file = Bun.file(path);
    const [text, stat] = await Promise.all([file.text(), file.stat()]);
    return { path, text, mtimeMs: stat.mtimeMs };
  } catch {
    // Missing, unreadable, or a directory: every case means this path holds
    // nothing usable, which the caller treats the same as no candidate here.
    return null;
  }
}

// A `$TMPDIR`-relative body may resolve to an empty guess while the real file
// sits under a second, sandboxed guess, so every candidate is tried and the
// newest hit wins.
async function readBodyFile(path: string): Promise<{ path: string; text: string } | null> {
  const found = (await Promise.all(tmpdirCandidates(path).map(readCandidate))).filter(
    (candidate): candidate is ReadCandidate => candidate !== null,
  );
  const newest = found.toSorted((a, b) => b.mtimeMs - a.mtimeMs).at(0);
  return newest === undefined ? null : { path: newest.path, text: newest.text };
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

// The whole body has to come from one non-dash heredoc: the span is only
// meaningful to splice back when nothing else contributed to the body around
// it.
function rewritableHeredoc(parts: BodyPart[]): { span: Span } | null {
  const part = parts[0];
  if (parts.length !== 1 || part?.kind !== "heredoc" || part.dash) return null;
  return { span: part.span };
}

function unreadableFile(part: { path: string; writer?: string }): BodyResolution {
  if (part.writer === undefined) {
    return {
      kind: "unreadable",
      detail: `body file \`${part.path}\`, which does not exist yet or could not be read`,
    };
  }
  const writer = part.writer.length > 60 ? `${part.writer.slice(0, 57)}...` : part.writer;
  return {
    kind: "unreadable",
    detail: `body file \`${part.path}\`, which \`${writer}\` writes after the hook runs`,
  };
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
    if (part.kind === "literal" || part.kind === "heredoc") {
      chunks.push(part.text);
      continue;
    }
    const path = isAbsolute(part.path) ? part.path : join(base, part.path);
    // oxlint-disable-next-line no-await-in-loop -- returns on the first unreadable part, and a command carries at most a few.
    const read = await readBodyFile(path);
    if (read === null) return unreadableFile(part);
    files.push(read.path);
    chunks.push(read.text);
  }
  return {
    kind: "text",
    text: chunks.join(""),
    file: rewritableFile(invocation, spec.parts, files),
    heredoc: rewritableHeredoc(spec.parts),
  };
}

export function extractTitle(command: string): string | null {
  const invocation = findPrCommand(command);
  if (invocation === null) return null;
  const title = literal(flagValue(invocation.command.argv, TITLE_FLAGS));
  return title === null || title === "" ? null : title;
}
