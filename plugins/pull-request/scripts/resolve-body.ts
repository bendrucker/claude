// Where a `gh pr` / `glab mr` command gets its body and title from: heredocs,
// inline flag values, body files, and the `cd`s ahead of them.

import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";

// The `if` rules in hooks.json scope dispatch to `gh pr create`/`edit` and
// `glab mr create`/`update`, covering compound (`cd <dir> && gh pr create ...`)
// and env-prefixed (`GH_PAGER=cat gh pr create ...`) forms. The guards below
// repeat the check in-script so the validator is inert under any other
// dispatch, and run before the hook reads a body file or shells out to git.
const PR_BODY_VERB = /gh pr (?:create|edit)|glab mr (?:create|update)/;

// The verb has to sit where the shell would run it: at the start of the text or
// after a separator, with env assignments allowed ahead of it. The same words
// anywhere else are an argument to some other program, which is how a `--notes`
// value quoting a PR command reaches this hook at all.
function invocationPattern(verb: RegExp): RegExp {
  return new RegExp(String.raw`(?:^|[\n;|&(){}])[ \t]*(?:\w+=\S*[ \t]+)*(${verb.source})\b`, "g");
}

const PR_BODY_INVOCATION = invocationPattern(PR_BODY_VERB);

/** Offset of the verb itself, or -1 when the text holds no such invocation. */
function invocationIndex(text: string, pattern: RegExp): number {
  const match = firstUnquotedMatch(text, pattern, quotedSpans(text));
  const verb = match?.[1];
  if (match == null || verb === undefined) return -1;
  return match.index + match[0].length - verb.length;
}

export function isPrBodyCommand(command: string): boolean {
  return invocationIndex(parseCommand(command).text, PR_BODY_INVOCATION) !== -1;
}

function unquote(value: string): string {
  const match = value.match(/^(['"])(.*)\1$/s);
  return match?.[2] ?? value;
}

function unescapeDoubleQuoted(text: string): string {
  return text.replaceAll(/\\(["`$\\])/g, "$1");
}

function expandTmpdir(path: string): string {
  const tmpdir = process.env.TMPDIR?.replace(/\/$/, "");
  if (tmpdir == null || tmpdir === "") return path;
  return path.replaceAll(/\$\{TMPDIR\}|\$TMPDIR/g, tmpdir);
}

function normalizeBodyPath(raw: string): string {
  return expandTmpdir(unquote(raw)).replace(/^\.\//, "");
}

// A heredoc operator with its delimiter word. The lookbehind keeps `<<<`
// herestrings out. A quoted or escaped delimiter makes the body literal.
const HEREDOC_OPERATOR = /(?<!<)<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|(\\)?([A-Za-z_][A-Za-z0-9_]*))/g;

// Simple-command boundaries. `|` stays inside a segment so a heredoc piped
// into the CLI remains attached to the command it feeds.
const SEGMENT_SEPARATOR = /&&|\|\||;|\n/g;

// Where a segment writes its heredoc: a single `>` redirect or a `tee` sink.
// The redirect lookbehind skips `>>` (an append mixes the heredoc with the
// file's prior content), fd forms (`2>`), and `&>`. The tee pattern's leading
// character class skips flags, so `tee -a` also resolves to no target.
const REDIRECT_TARGET = /(?<![>\d&])>[ \t]*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&<>]+)/g;
const TEE_TARGET = /\btee\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&<>-][^\s;|&<>]*)/g;

export interface Heredoc {
  /** Body text as the shell delivers it, with `<<-` tab stripping applied. */
  content: string;
  /** The delimiter was quoted or escaped, so the shell expands nothing in the body. */
  quoted: boolean;
  /** The simple command the operator sits in. */
  segment: string;
  /** Normalized path the segment redirects or tees the body into, or null when it feeds stdin/stdout. */
  target: string | null;
  /** Offset of the operator in the stripped text, for ordering against the PR command. */
  offset: number;
}

export interface ParsedCommand {
  /** Command text with heredoc bodies removed, so verb and flag matching runs on shell syntax alone. */
  text: string;
  heredocs: Heredoc[];
}

interface PendingHeredoc {
  delimiter: string;
  quoted: boolean;
  stripTabs: boolean;
  segment: string;
  target: string | null;
  offset: number;
  lines: string[];
}

// Spans covered by a quoted string, so a `<<` inside an argument (`grep "<<EOF"
// f`) is not read as an operator. Backslash escapes a quote outside single
// quotes, where the shell treats it literally. Quoting runs across newlines, so
// a multi-line flag value scanned whole is one span.
function quotedSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let open: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && open !== "'") {
      i++;
      continue;
    }
    if (open === null) {
      if (ch === "'" || ch === '"') {
        open = ch;
        start = i;
      }
    } else if (ch === open) {
      spans.push([start, i]);
      open = null;
    }
  }
  if (open !== null) spans.push([start, line.length]);
  return spans;
}

function withinSpans(index: number, spans: [number, number][]): boolean {
  return spans.some(([start, end]) => index > start && index <= end);
}

// First match whose own start sits outside every quoted span. The value a
// match captures may still be quoted. Only the operator or flag itself must
// not be.
function firstUnquotedMatch(
  text: string,
  pattern: RegExp,
  spans: [number, number][],
): RegExpExecArray | null {
  for (const match of text.matchAll(pattern)) {
    if (!withinSpans(match.index, spans)) return match;
  }
  return null;
}

function segmentAt(line: string, index: number, spans: [number, number][]): string {
  let start = 0;
  let end = line.length;
  for (const sep of line.matchAll(SEGMENT_SEPARATOR)) {
    if (withinSpans(sep.index, spans)) continue;
    if (sep.index < index) {
      start = sep.index + sep[0].length;
    } else {
      end = sep.index;
      break;
    }
  }
  return line.slice(start, end);
}

function segmentTarget(segment: string): string | null {
  const spans = quotedSpans(segment);
  const value =
    firstUnquotedMatch(segment, REDIRECT_TARGET, spans)?.[1] ??
    firstUnquotedMatch(segment, TEE_TARGET, spans)?.[1];
  return value === undefined ? null : normalizeBodyPath(value);
}

// Line-oriented heredoc scan: a body runs from the line after its operator to
// the delimiter line, and several operators on one line consume bodies in
// order. An unterminated heredoc owns the rest of the command, which is also
// what the shell would feed it.
export function parseCommand(command: string): ParsedCommand {
  const kept: string[] = [];
  const heredocs: Heredoc[] = [];
  const queue: PendingHeredoc[] = [];

  const close = (pending: PendingHeredoc): void => {
    heredocs.push({
      content: pending.lines.length === 0 ? "" : `${pending.lines.join("\n")}\n`,
      quoted: pending.quoted,
      segment: pending.segment,
      target: pending.target,
      offset: pending.offset,
    });
  };

  let textOffset = 0;
  for (const line of command.split("\n")) {
    const open = queue[0];
    if (open !== undefined) {
      const body = open.stripTabs ? line.replace(/^\t+/, "") : line;
      if (body === open.delimiter) {
        queue.shift();
        close(open);
      } else {
        open.lines.push(body);
      }
      continue;
    }
    kept.push(line);
    const spans = quotedSpans(line);
    for (const match of line.matchAll(HEREDOC_OPERATOR)) {
      if (withinSpans(match.index, spans)) continue;
      const segment = segmentAt(line, match.index, spans);
      queue.push({
        delimiter: match[2] ?? match[3] ?? match[5] ?? "",
        quoted: match[2] !== undefined || match[3] !== undefined || match[4] !== undefined,
        stripTabs: match[1] === "-",
        segment,
        target: segmentTarget(segment),
        offset: textOffset + match.index,
        lines: [],
      });
    }
    textOffset += line.length + 1;
  }
  for (const pending of queue) close(pending);
  return { text: kept.join("\n"), heredocs };
}

// One flag value as the shell would word-split it: a quoted string, a command
// substitution, or a bare word.
const VALUE_PATTERN = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|\$\((?:[^()]|\([^()]*\))*\)|[^\s]+)`;

type PrCli = "gh" | "glab";

const CLI_PATTERNS: readonly (readonly [PrCli, RegExp])[] = [
  ["gh", /\bgh pr (?:create|edit)\b/],
  ["glab", /\bglab mr (?:create|update)\b/],
];

// `-b` is `--body` on gh and `--target-branch` on glab; `-d` is `--description`
// on glab and `--draft` on gh. A shorthand means a body only on the CLI that
// owns it, so the flag sets are keyed by CLI. A fragment naming neither verb
// falls back to the union, so a bare flag form lifted out of a skill doc still
// resolves.
const BODY_FLAGS: Record<PrCli, { file: string[]; inline: string[] }> = {
  gh: { file: ["--body-file"], inline: ["--body", "-b"] },
  glab: { file: ["--description-file"], inline: ["--description", "-d"] },
};

function commandCli(command: string): PrCli | null {
  let earliest: PrCli | null = null;
  let earliestIndex = Number.POSITIVE_INFINITY;
  for (const [cli, pattern] of CLI_PATTERNS) {
    const index = command.search(pattern);
    if (index !== -1 && index < earliestIndex) {
      earliestIndex = index;
      earliest = cli;
    }
  }
  return earliest;
}

function bodyFlags(command: string): { file: string[]; inline: string[] } {
  const cli = commandCli(command);
  if (cli !== null) return BODY_FLAGS[cli];
  return {
    file: [...BODY_FLAGS.gh.file, ...BODY_FLAGS.glab.file],
    inline: [...BODY_FLAGS.gh.inline, ...BODY_FLAGS.glab.inline],
  };
}

function flagValuePattern(flags: string[], global = false): RegExp {
  const alternation = flags
    .map((flag) => (flag.startsWith("--") ? flag : `(?<!\\w)${flag}`))
    .join("|");
  return new RegExp(`(?:${alternation})[=\\s]${VALUE_PATTERN}`, global ? "g" : "");
}

// An unescaped `$(...)` or backtick run. The shell replaces it before the CLI
// sees it, so its source text is not the body.
const SUBSTITUTION_PATTERN = /(?<!\\)\$\((?:[^()]|\([^()]*\))*\)|(?<!\\)`[^`]*`/g;

// A substitution whose whole job is to read a file: `$(cat f)`, `$(< f)`,
// `` `cat f` ``. GitLab has no way to pass a body inline from a file, so this
// is the form every historical `glab mr` invocation uses.
const FILE_READ_PATTERN = /^(?:cat\s+|<\s*)("[^"]+"|'[^']+'|[^\s]+)$/;

// A `$VAR`, `${VAR}`, `$(...)`, or backtick left over after the file reads are
// taken out. The shell resolves it and the hook cannot, so the text the hook
// holds is not the text the CLI will receive.
const SHELL_EXPANSION_PATTERN = /(?<!\\)(?:\$\{[^}]*\}?|\$[A-Za-z_]\w*|\$\([^)]*\)?|`)/;

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

// Null when the path itself is a variable the shell resolves and the hook
// cannot, so the caller reports it unreadable rather than reading the wrong
// file.
function filePart(rawPath: string): BodyPart | null {
  const path = expandTmpdir(unquote(rawPath));
  if (SHELL_EXPANSION_PATTERN.test(path)) return null;
  return { kind: "file", path };
}

// A double-quoted value is a mix of literal runs and substitutions, so it is
// walked rather than matched: each `$(cat f)` becomes a file part, each run
// between them a literal. Escapes are stripped from the literal runs only, so a
// `\"` inside the file's own text survives. Single quotes suppress every
// expansion, so that value is literal whatever it holds.
function parseInlineValue(raw: string): BodySpec {
  const single = raw.match(/^'(.*)'$/s);
  if (single) return { kind: "parts", parts: [{ kind: "literal", text: single[1] ?? "" }] };
  if (unquote(raw) === "-") {
    return { kind: "unreadable", detail: "a body typed into an editor (`-`)" };
  }
  const inner = raw.match(/^"(.*)"$/s)?.[1] ?? raw;

  const parts: BodyPart[] = [];
  let cursor = 0;
  const pushLiteral = (segment: string): BodySpec | null => {
    const stray = segment.match(SHELL_EXPANSION_PATTERN);
    if (stray) return unreadableExpansion(stray[0]);
    if (segment.length > 0) parts.push({ kind: "literal", text: unescapeDoubleQuoted(segment) });
    return null;
  };

  for (const match of inner.matchAll(SUBSTITUTION_PATTERN)) {
    const source = match[0];
    const index = match.index;
    const literal = pushLiteral(inner.slice(cursor, index));
    if (literal) return literal;
    const substituted = source.startsWith("`") ? source.slice(1, -1) : source.slice(2, -1);
    const read = substituted.trim().match(FILE_READ_PATTERN)?.[1];
    if (read === undefined) return unreadableExpansion(source);
    const part = filePart(read);
    if (part === null) return unreadableExpansion(read);
    parts.push(part);
    cursor = index + source.length;
  }
  const tail = pushLiteral(inner.slice(cursor));
  if (tail) return tail;
  return { kind: "parts", parts };
}

// Null when the delimiter is unquoted and the body holds an expansion the
// shell will rewrite before the CLI sees it.
function heredocLiteral(heredoc: Heredoc): BodyPart | null {
  if (!heredoc.quoted && SHELL_EXPANSION_PATTERN.test(heredoc.content)) return null;
  return { kind: "literal", text: heredoc.content };
}

function heredocExpansion(heredoc: Heredoc): BodySpec {
  const source = heredoc.content.match(SHELL_EXPANSION_PATTERN)?.[0] ?? "";
  return {
    kind: "unreadable",
    detail: `an unquoted heredoc holding a shell expansion the hook cannot evaluate (\`${source.trim()}\`)`,
  };
}

function heredocSpec(heredoc: Heredoc): BodySpec {
  const part = heredocLiteral(heredoc);
  if (part === null) return heredocExpansion(heredoc);
  return { kind: "parts", parts: [part] };
}

// Swap each file part for the heredoc that writes that path in the same
// command, so a body created and passed in one call validates without touching
// a file the command has not written yet. Only writes ahead of the PR command
// count (a later write is not what the CLI reads), and the last of those wins,
// as it would in the shell.
function resolveHeredocParts(parts: BodyPart[], heredocs: Heredoc[]): BodySpec {
  const resolved: BodyPart[] = [];
  for (const part of parts) {
    if (part.kind === "file") {
      const heredoc = heredocs.findLast((doc) => doc.target === normalizeBodyPath(part.path));
      if (heredoc !== undefined) {
        const replacement = heredocLiteral(heredoc);
        if (replacement === null) return heredocExpansion(heredoc);
        resolved.push(replacement);
        continue;
      }
    }
    resolved.push(part);
  }
  return { kind: "parts", parts: resolved };
}

// Simple commands ahead of an offset, so a segment keeps its own redirect.
function segmentsBefore(text: string, index: number): string[] {
  const scope = text.slice(0, index);
  const spans = quotedSpans(scope);
  const segments: string[] = [];
  let start = 0;
  for (const separator of scope.matchAll(SEGMENT_SEPARATOR)) {
    if (withinSpans(separator.index, spans)) continue;
    segments.push(scope.slice(start, separator.index));
    start = separator.index + separator[0].length;
  }
  segments.push(scope.slice(start));
  return segments;
}

const PR_VIEW_INVOCATIONS: Record<PrCli, { verb: RegExp; pattern: RegExp }> = {
  gh: { verb: /gh pr view/, pattern: invocationPattern(/gh pr view/) },
  glab: { verb: /glab mr view/, pattern: invocationPattern(/glab mr view/) },
};

// The verb's first positional argument: a PR number, URL, or branch. Null when
// the command leaves it off and the CLI resolves the current branch's PR, which
// both commands in a round trip do.
function prSelector(text: string, verb: RegExp): string | null {
  const value = text.match(
    new RegExp(String.raw`^(?:${verb.source})[ \t]+("[^"]*"|'[^']*'|[^-\s;|&<>][^\s;|&<>]*)`),
  )?.[1];
  return value === undefined ? null : unquote(value);
}

/**
 * Whether the command reads the same PR it is about to edit into the body file:
 * `gh pr view <n> ... > body.md && <edit body.md> && gh pr edit <n> --body-file
 * body.md`. The hook runs before the shell, so whatever that path holds now is
 * not what the CLI will send, and no content the hook could read would change
 * the outcome. The trade is that an edit-in-place round trip ships unvalidated.
 *
 * A generator writing the same path (`printf ... > body.md`) is not this shape
 * and still has to hand the hook a body it can read.
 */
function readsBackSamePr(text: string, path: string): boolean {
  const cli = commandCli(text);
  const editIndex = invocationIndex(text, PR_BODY_INVOCATION);
  if (cli === null || editIndex === -1) return false;
  const name = basename(normalizeBodyPath(path));
  if (name === "") return false;
  const selector = prSelector(text.slice(editIndex), PR_BODY_VERB);
  const view = PR_VIEW_INVOCATIONS[cli];
  return segmentsBefore(text, editIndex).some((segment) => {
    const viewIndex = invocationIndex(segment, view.pattern);
    if (viewIndex === -1) return false;
    const target = segmentTarget(segment);
    if (target === null || basename(target) !== name) return false;
    return prSelector(segment.slice(viewIndex), view.verb) === selector;
  });
}

// Both spellings of stdin. `/dev/stdin` matters because reading it from the
// hook would consume the hook's own (already-drained) stdin and validate an
// empty body.
const STDIN_PATHS = new Set(["-", "/dev/stdin"]);

export function extractBodySpec(command: string): BodySpec {
  const { text, heredocs } = parseCommand(command);
  const flags = bodyFlags(text);
  const spans = quotedSpans(text);
  const fileValue = firstUnquotedMatch(text, flagValuePattern(flags.file, true), spans)?.[1];
  if (fileValue != null && fileValue !== "") {
    const path = unquote(fileValue);
    if (STDIN_PATHS.has(path)) {
      // The last stdin redirection wins, as it does in the shell.
      const fed = heredocs.findLast(
        (doc) => doc.target === null && invocationIndex(doc.segment, PR_BODY_INVOCATION) !== -1,
      );
      if (fed !== undefined) return heredocSpec(fed);
      return { kind: "unreadable", detail: `a body piped in on standard input (\`${path}\`)` };
    }
    const part = filePart(fileValue);
    if (part === null) return unreadableExpansion(path);
    const spec = resolveHeredocParts([part], precedingHeredocs(text, heredocs));
    const only = spec.kind === "parts" && spec.parts.length === 1 ? spec.parts[0] : undefined;
    if (only?.kind === "file" && readsBackSamePr(text, only.path)) return { kind: "none" };
    return spec;
  }
  const inlineValue = firstUnquotedMatch(text, flagValuePattern(flags.inline, true), spans)?.[1];
  if (inlineValue == null || inlineValue === "") return { kind: "none" };
  const inline = parseInlineValue(inlineValue);
  if (inline.kind !== "parts") return inline;
  return resolveHeredocParts(inline.parts, precedingHeredocs(text, heredocs));
}

function precedingHeredocs(text: string, heredocs: Heredoc[]): Heredoc[] {
  const prIndex = invocationIndex(text, PR_BODY_INVOCATION);
  if (prIndex === -1) return [];
  return heredocs.filter((doc) => doc.offset < prIndex);
}

/** The body text a command will send, or why the hook cannot see it. */
export type BodyResolution =
  | { kind: "none" }
  | {
      kind: "text";
      text: string;
      /**
       * Absolute path the whole body was read from, so a caller may rewrite it.
       * Null when any of the body came from the command itself, where a rewrite
       * would be overwritten by the command or would have to edit shell syntax.
       */
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
// path, so the hook follows each one it can evaluate before reading files.
// `||` is excluded from the lead-ins: a `cd a || cd b` fallback only runs when
// the first cd failed, so the hook follows the success path.
const CD_PATTERN = /(?:^|&&|;|\n)\s*cd\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&]+)/g;

export function effectiveCwd(command: string, cwd: string): string {
  const text = parseCommand(command).text;
  const start = invocationIndex(text, PR_BODY_INVOCATION);
  const scope = start === -1 ? text : text.slice(0, start);
  let dir = cwd;
  for (const match of scope.matchAll(CD_PATTERN)) {
    const target = expandTmpdir(unquote(match[1] ?? ""));
    if (target === "" || target === "-" || SHELL_EXPANSION_PATTERN.test(target)) continue;
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

export async function resolveBody(command: string, cwd: string): Promise<BodyResolution> {
  const spec = extractBodySpec(command);
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
  return { kind: "text", text: chunks.join(""), file: rewritableFile(command, spec.parts, files) };
}

/**
 * The one file the whole body was read from, when rewriting it would survive to
 * the PR. Null when the body is assembled from more than one source, and null
 * when the command names that file ahead of the PR verb: a generator writing
 * the same path (`gen.py > body.md && gh pr create --body-file body.md`)
 * replaces it after the hook reads it, so a correction would be discarded and
 * the hook would report a fix the PR never carried. Naming the file is the
 * signal a redirect, a `tee`, or an output flag all leave in the text.
 *
 * The two spellings need not match, since `> body.md` and `--body-file
 * $PWD/body.md` are the same file, so the match is on the file name alone.
 * That also catches names that only look alike, which costs the author a round
 * trip through the deny rather than a body the hook reported as fixed and did
 * not fix.
 */
function rewritableFile(command: string, parts: BodyPart[], files: string[]): string | null {
  if (parts.length !== 1 || files.length !== 1) return null;
  const part = parts[0];
  if (part?.kind !== "file") return null;
  const text = parseCommand(command).text;
  const prIndex = invocationIndex(text, PR_BODY_INVOCATION);
  if (prIndex === -1) return null;
  const name = basename(part.path);
  if (name === "" || text.slice(0, prIndex).includes(name)) return null;
  return files[0] ?? null;
}

// Anchored to the `gh pr`/`glab mr` verb with heredoc bodies stripped and the
// body values blanked first: an unanchored scan reads a ` -t ` from an earlier
// command in a compound (`mktemp -t`), and a `--title` mentioned inside a body
// string, as the PR title.
export function extractTitle(command: string): string | null {
  const text = parseCommand(command).text;
  const start = invocationIndex(text, PR_BODY_INVOCATION);
  const flags = bodyFlags(text);
  const scope = (start === -1 ? text : text.slice(start))
    .replace(flagValuePattern(flags.file, true), " ")
    .replace(flagValuePattern(flags.inline, true), " ");
  const value = scope.match(/(?:--title|(?<![\w-])-t)[=\s]("(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+)/)?.[1];
  if (value == null || value === "") return null;
  return unescapeDoubleQuoted(unquote(value));
}
