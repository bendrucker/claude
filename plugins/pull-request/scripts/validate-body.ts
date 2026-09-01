import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { headingCaseViolations } from "./heading-case";
import { LINKING_VERBS } from "./linguistics/heading";
import { countProseWords, headingTexts, linesOutsideFences, stripEmphasis } from "./markdown";
import { classifyPrHeading } from "./sentence-heading";

const BashInput = z.looseObject({ command: z.string() });

export const HookInput = z.looseObject({
  cwd: z.string().optional(),
  tool_input: z.unknown(),
});
export type HookInput = z.infer<typeof HookInput>;

const TEST_COUNT_PATTERN =
  /[Aa]dded [0-9]+ (unit |integration )?tests|[0-9]+ (unit |integration )?tests|[0-9]+ assertions|[0-9]+ pass(?:ed|es)?,\s*[0-9]+ fail/;

// A roll-call of green status checks (`all green`, `0 errors, 0 warnings`,
// `lint passes`, `npm run build` green) restates what the PR's status checks
// already show. This warns rather than denies: whether a check is in CI is a
// judgment the hook can't make, and a genuinely non-CI signal (a manual run, an
// intentional exclusion, a pre-existing warning) is worth keeping.
// Adjacency (only an adverb may sit between the check and its status word) keeps
// these off prose where the same words carry a different sense, e.g. "the tests
// already pass VARCHAR literals" (pass = the verb, not a status).
const CI_STATUS_PATTERNS: RegExp[] = [
  /\ball (?:checks? (?:pass|green)|green)\b/i,
  /\b0 errors?,?\s*0 warnings?\b/i,
  /\b(?:lint|types?|typecheck|type checking|build|tests?|checks?)\s+(?:all |also |now |is |are |was |were )?(?:pass(?:es|ed)?|green|clean)\b/i,
  /\b(?:pass(?:es|ed|ing)?|green|clean)\s+(?:in )?ci\b/i,
];

// Mirrors the writing plugin's "template on small document" detector: a full
// `## Changes` + `## Testing` scaffold on a body under this many words is
// over-structured. Reimplemented locally to avoid a cross-plugin import.
const SMALL_BODY_WORD_LIMIT = 150;

const AUTOLINK_REASON =
  "Commit SHAs and issue/MR refs (`#123`, `!45`) auto-link on GitHub/GitLab. Backticks render them as code and suppress the link. Write them bare.";

const CHANGES_HEADING_PATTERN = /^##\s+Changes\b/m;
const TESTING_HEADING_PATTERN = /^##\s+Testing\b/m;

// File-tour bullet: a `- **label:**` or `* **label:**` item whose bold label
// names a file rather than a concept. Captures the label so the path heuristic
// can inspect it.
const BOLD_LABEL_BULLET_PATTERN = /^\s*[-*]\s+\*\*([^*]+?)\*\*:/gm;

const FILE_EXTENSION_PATTERN =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|py|rb|go|rs|java|c|h|cpp|sh|yml|yaml|toml|css|html|sql)$/i;

function looksLikeFilePath(label: string): boolean {
  const trimmed = label
    .trim()
    .replace(/^`+|`+$/g, "")
    .trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("/")) return true;
  return FILE_EXTENSION_PATTERN.test(trimmed);
}

export function hasReflexiveScaffold(body: string): boolean {
  if (countProseWords(body) >= SMALL_BODY_WORD_LIMIT) return false;
  return CHANGES_HEADING_PATTERN.test(body) && TESTING_HEADING_PATTERN.test(body);
}

export function hasFileTourBullets(body: string): boolean {
  for (const match of body.matchAll(BOLD_LABEL_BULLET_PATTERN)) {
    const label = match[1];
    if (label != null && label !== "" && looksLikeFilePath(label)) return true;
  }
  return false;
}

export function hasCiStatusRollCall(body: string): boolean {
  return CI_STATUS_PATTERNS.some((pattern) => pattern.test(body));
}

// Prose density thresholds. A paragraph past MAX_SENTENCES_PER_PARAGRAPH runs
// more than one thread. A sentence past RUN_ON_CHARS is a wall. A sentence with
// COMMA_SPLICE_MIN_COMMAS commas past COMMA_SPLICE_MIN_CHARS is an enumeration
// that belongs in a list.
export const RUN_ON_CHARS = 280;
export const COMMA_SPLICE_MIN_COMMAS = 3;
export const COMMA_SPLICE_MIN_CHARS = 220;
export const MAX_SENTENCES_PER_PARAGRAPH = 4;

// Join the body into prose paragraphs, dropping fenced code, tables, headings,
// list items, and blockquotes so density is measured on prose alone. Fence
// tracking lives in `linesOutsideFences`, which yields a blank line per fenced
// block so the paragraphs around it stay separate.
export function proseParagraphs(body: string): string[] {
  const paras: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) paras.push(buf.join(" ").trim());
    buf = [];
  };
  for (const line of linesOutsideFences(body)) {
    if (line.trim() === "" || /^\s*(#{1,6}\s|[-*]\s|\d+[.)]\s|\||>)/.test(line)) {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  return paras.filter((p) => p.length > 0);
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`(])/).filter((s) => s.trim().length > 0);
}

export function hasRunOnProse(body: string): boolean {
  for (const para of proseParagraphs(body)) {
    const sentences = splitSentences(para);
    if (sentences.length > MAX_SENTENCES_PER_PARAGRAPH) return true;
    for (const sentence of sentences) {
      if (sentence.length > RUN_ON_CHARS) return true;
      const commas = (sentence.match(/,/g) ?? []).length;
      if (commas >= COMMA_SPLICE_MIN_COMMAS && sentence.length > COMMA_SPLICE_MIN_CHARS)
        return true;
    }
  }
  return false;
}

// Vocabulary that leaks the instructions into the output: the body claims a
// choice was made on purpose, or that a fact is worth the reader's attention.
export const NARRATION_TELLS = [
  "deliberately",
  "on purpose",
  "worth noting",
  "worth naming",
  "worth knowing",
  "non-obvious",
  "left alone",
  "leaves alone",
] as const;

export type NarrationTell = (typeof NARRATION_TELLS)[number];

/** Regex source for one tell, shared with the eval scorer so both match identically. */
export function narrationTellSource(tell: string): string {
  return `\\b${tell.replace(/ /g, "\\s+")}\\b`;
}

const TELL_PATTERNS = NARRATION_TELLS.map(
  (tell) => [tell, new RegExp(narrationTellSource(tell), "i")] as const,
);

export function findNarrationTells(body: string): NarrationTell[] {
  const prose = linesOutsideFences(body).join("\n");
  return TELL_PATTERNS.filter(([, pattern]) => pattern.test(prose)).map(([tell]) => tell);
}

export interface SentenceHeading {
  text: string;
  signals: string[];
}

// The classifier's sentence-case signal restates what the AP title-case deny
// already reports, so a heading needs a shape signal beyond its casing to be
// worth a second note. A bare non-linking predicate verb is also too weak on
// its own here: deverbal noun compounds ("Future Work", "Bug Fixes", "Use
// Cases") hit it constantly, so the hook warns only when a linking verb or a
// second signal class confirms the sentence shape. The eval scorer keeps the
// raw classifier.
function isBareNonLinkingVerb(signal: string): boolean {
  const match = signal.match(/^predicate verb "(.+)"$/);
  return match !== null && !LINKING_VERBS.has(match[1] ?? "");
}

export function sentenceShapedHeadings(body: string): SentenceHeading[] {
  const flagged: SentenceHeading[] = [];
  for (const text of headingTexts(body)) {
    const signals = classifyPrHeading(stripEmphasis(text)).signals.filter(
      (signal) => !signal.startsWith("sentence case"),
    );
    if (signals.length > 0 && !signals.every(isBareNonLinkingVerb)) {
      flagged.push({ text, signals });
    }
  }
  return flagged;
}

// A body past this length is a document. On a repo the author owns and merges
// alone, nobody is going to read it.
export const PERSONAL_BODY_WORD_LIMIT = 450;

export function isLongBody(body: string): boolean {
  return countProseWords(body) > PERSONAL_BODY_WORD_LIMIT;
}

const SSH_REMOTE = /^[\w.+-]+@([\w.-]+):(.+)$/;
const URL_REMOTE = /^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i;

export interface ParsedRemote {
  host: string;
  owner: string;
}

export function parseRemote(remoteUrl: string): ParsedRemote | null {
  const trimmed = remoteUrl.trim();
  const match = trimmed.match(SSH_REMOTE) ?? trimmed.match(URL_REMOTE);
  const host = match?.[1];
  const path = match?.[2];
  if (host === undefined || path === undefined) return null;
  const owner = path.replace(/^\/+/, "").split("/")[0];
  if (owner === undefined || owner.length === 0) return null;
  return { host: host.toLowerCase(), owner };
}

// `hosts.yml` is two levels deep (host, then per-host keys), so a line-oriented
// read is enough and keeps a YAML parser out of the hook's startup path.
export function parseGhLogin(hostsYaml: string): string | null {
  let inGitHub = false;
  for (const line of hostsYaml.split("\n")) {
    if (/^\S/.test(line)) {
      inGitHub = line.trim().replace(/:$/, "") === "github.com";
      continue;
    }
    if (!inGitHub) continue;
    const user = line.match(/^\s+user:\s*(.+?)\s*$/)?.[1];
    if (user != null && user !== "") return user.replace(/^["']|["']$/g, "");
  }
  return null;
}

async function readGitRemote(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const url = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? url.trim() : null;
  } catch {
    return null;
  }
}

async function readGhHosts(): Promise<string | null> {
  try {
    return await Bun.file(join(homedir(), ".config", "gh", "hosts.yml")).text();
  } catch {
    return null;
  }
}

// The login comes from `hosts.yml`'s github.com entry, so the owner comparison
// only means anything on a github.com remote. A GitLab or GHES remote whose
// namespace happens to match the github.com handle is someone else's repo.
export function isPersonalRepo(remote: string | null, hostsYaml: string | null): boolean {
  if (remote === null || hostsYaml === null) return false;
  const parsed = parseRemote(remote);
  const login = parseGhLogin(hostsYaml);
  if (parsed === null || login === null) return false;
  return parsed.host === "github.com" && parsed.owner.toLowerCase() === login.toLowerCase();
}

export const TITLE_LENGTH_LIMIT = 50;

// Each pattern stacks clauses onto a title that should carry one.
export function hasClauseStacking(title: string): boolean {
  if (/,\s*(?:and|or|but|nor|for|so|yet)\b/i.test(title)) return true;
  if ((title.match(/,/g) ?? []).length >= 2) return true;
  return /:[^,]*,/.test(title);
}

// Backticked hex run that could be a commit SHA. Only a filter: the git object
// database settles whether a candidate is a real commit.
const BACKTICKED_HEX_PATTERN = /`([0-9a-f]{7,40})`/g;

// Backticked issue/MR reference: `#123`, `!45`, or `owner/repo#12`. Digits-only
// after the sigil rules out CSS ids (`#main`) and code annotations. `@mentions`
// are deliberately excluded because they have legitimate uses in code and prose.
const BACKTICKED_REF_PATTERN = /`(?:[\w.-]+\/[\w.-]+)?[#!]\d+`/;

export function extractBacktickedHexCandidates(body: string): string[] {
  return Array.from(body.matchAll(BACKTICKED_HEX_PATTERN), (match) => match[1]).filter(
    (token): token is string => token !== undefined,
  );
}

export function hasBacktickedRef(body: string): boolean {
  return BACKTICKED_REF_PATTERN.test(body);
}

export function gitCommitVerifier(cwd: string): (sha: string) => Promise<boolean> {
  return async (sha) => {
    try {
      const proc = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`], {
        cwd,
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  };
}

export async function findBacktickedCommits(
  candidates: string[],
  verify: (sha: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    candidates.map(async (candidate) => ((await verify(candidate)) ? candidate : null)),
  );
  return results.filter((sha): sha is string => sha !== null);
}

// The `if` rules in hooks.json scope dispatch to `gh pr create`/`edit` and
// `glab mr create`/`update`, covering compound (`cd <dir> && gh pr create ...`)
// and env-prefixed (`GH_PAGER=cat gh pr create ...`) forms. This guard repeats
// the check in-script so the validator is inert under any other dispatch, and
// runs before the hook reads a body file or shells out to git. It matches the
// heredoc-stripped text, so a heredoc body that merely mentions a create
// command stays inert.
const PR_BODY_COMMAND_PATTERN = /\b(?:gh pr (?:create|edit)|glab mr (?:create|update))\b/;

export function isPrBodyCommand(command: string): boolean {
  return PR_BODY_COMMAND_PATTERN.test(parseCommand(command).text);
}

function unquote(value: string): string {
  const match = value.match(/^(['"])(.*)\1$/s);
  return match?.[2] ?? value;
}

function unescapeDoubleQuoted(text: string): string {
  return text.replace(/\\(["`$\\])/g, "$1");
}

function expandTmpdir(path: string): string {
  const tmpdir = process.env.TMPDIR?.replace(/\/$/, "");
  if (tmpdir == null || tmpdir === "") return path;
  return path.replace(/\$\{TMPDIR\}|\$TMPDIR/g, tmpdir);
}

function normalizeBodyPath(raw: string): string {
  return expandTmpdir(unquote(raw)).replace(/^\.\//, "");
}

// A heredoc operator with its delimiter word. The lookbehind keeps `<<<`
// herestrings out. A quoted or escaped delimiter makes the body literal.
const HEREDOC_OPERATOR = /(?<!<)<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|(\\)?([A-Za-z_][A-Za-z0-9_]*))/g;

// Simple-command boundaries within one line. `|` stays inside a segment so a
// heredoc piped into the CLI remains attached to the command it feeds.
const SEGMENT_SEPARATOR = /&&|\|\||;/g;

// Where a segment writes its heredoc: a single `>` redirect or a `tee` sink.
// The redirect lookbehind skips `>>` (an append mixes the heredoc with the
// file's prior content), fd forms (`2>`), and `&>`. The tee pattern's leading
// character class skips flags, so `tee -a` also resolves to no target.
const REDIRECT_TARGET = /(?<![>\d&])>[ \t]*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&<>]+)/;
const TEE_TARGET = /\btee\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&<>-][^\s;|&<>]*)/;

export interface Heredoc {
  /** Body text as the shell delivers it, with `<<-` tab stripping applied. */
  content: string;
  /** The delimiter was quoted or escaped, so the shell expands nothing in the body. */
  quoted: boolean;
  /** The simple command the operator sits in. */
  segment: string;
  /** Normalized path the segment redirects or tees the body into, or null when it feeds stdin/stdout. */
  target: string | null;
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
  lines: string[];
}

function segmentAt(line: string, index: number): string {
  let start = 0;
  let end = line.length;
  for (const sep of line.matchAll(SEGMENT_SEPARATOR)) {
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
  const value = segment.match(REDIRECT_TARGET)?.[1] ?? segment.match(TEE_TARGET)?.[1];
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
    });
  };

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
    for (const match of line.matchAll(HEREDOC_OPERATOR)) {
      const segment = segmentAt(line, match.index);
      queue.push({
        delimiter: match[2] ?? match[3] ?? match[5] ?? "",
        quoted: match[2] !== undefined || match[3] !== undefined || match[4] !== undefined,
        stripTabs: match[1] === "-",
        segment,
        target: segmentTarget(segment),
        lines: [],
      });
    }
  }
  for (const pending of queue) close(pending);
  return { text: kept.join("\n"), heredocs };
}

// One flag value as the shell would word-split it: a quoted string, a command
// substitution, or a bare word.
const VALUE_PATTERN = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|\$\((?:[^()]|\([^()]*\))*\)|[^\s]+)`;

type PrCli = "gh" | "glab";

const CLI_PATTERNS: ReadonlyArray<readonly [PrCli, RegExp]> = [
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
// a file the command has not written yet. The last write wins, as it would in
// the shell.
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

// Both spellings of stdin. `/dev/stdin` matters because reading it from the
// hook would consume the hook's own (already-drained) stdin and validate an
// empty body.
const STDIN_PATHS = new Set(["-", "/dev/stdin"]);

export function extractBodySpec(command: string): BodySpec {
  const { text, heredocs } = parseCommand(command);
  const flags = bodyFlags(text);
  const fileValue = text.match(flagValuePattern(flags.file))?.[1];
  if (fileValue != null && fileValue !== "") {
    const path = unquote(fileValue);
    if (STDIN_PATHS.has(path)) {
      const fed = heredocs.find(
        (doc) => doc.target === null && PR_BODY_COMMAND_PATTERN.test(doc.segment),
      );
      if (fed !== undefined) return heredocSpec(fed);
      return { kind: "unreadable", detail: `a body piped in on standard input (\`${path}\`)` };
    }
    const part = filePart(fileValue);
    if (part === null) return unreadableExpansion(path);
    return resolveHeredocParts([part], heredocs);
  }
  const inlineValue = text.match(flagValuePattern(flags.inline))?.[1];
  if (inlineValue == null || inlineValue === "") return { kind: "none" };
  const inline = parseInlineValue(inlineValue);
  if (inline.kind !== "parts") return inline;
  return resolveHeredocParts(inline.parts, heredocs);
}

/** The body text a command will send, or why the hook cannot see it. */
export type BodyResolution =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "unreadable"; detail: string };

async function readBodyFile(path: string, cwd: string): Promise<string | null> {
  try {
    return await Bun.file(isAbsolute(path) ? path : join(cwd, path)).text();
  } catch {
    return null;
  }
}

// A `cd` ahead of the PR command moves where the CLI resolves a relative body
// path, so the hook follows each one it can evaluate before reading files.
const CD_PATTERN = /(?:^|&&|\|\||;|\n)\s*cd\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&]+)/g;

export function effectiveCwd(command: string, cwd: string): string {
  const text = parseCommand(command).text;
  const start = text.search(PR_BODY_COMMAND_PATTERN);
  const scope = start === -1 ? text : text.slice(0, start);
  let dir = cwd;
  for (const match of scope.matchAll(CD_PATTERN)) {
    const target = expandTmpdir(unquote(match[1] ?? ""));
    if (target === "" || target === "-" || SHELL_EXPANSION_PATTERN.test(target)) continue;
    if (target === "~" || target.startsWith("~/")) {
      dir = join(homedir(), target.slice(1));
    } else {
      dir = isAbsolute(target) ? target : join(dir, target);
    }
  }
  return dir;
}

export async function resolveBody(command: string, cwd: string): Promise<BodyResolution> {
  const spec = extractBodySpec(command);
  if (spec.kind !== "parts") return spec;
  const base = effectiveCwd(command, cwd);
  const chunks: string[] = [];
  for (const part of spec.parts) {
    if (part.kind === "literal") {
      chunks.push(part.text);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- returns on the first unreadable part, and a command carries at most a few.
    const text = await readBodyFile(part.path, base);
    if (text === null) {
      return {
        kind: "unreadable",
        detail: `body file \`${part.path}\`, which does not exist yet or could not be read`,
      };
    }
    chunks.push(text);
  }
  return { kind: "text", text: chunks.join("") };
}

// Anchored to the `gh pr`/`glab mr` verb with heredoc bodies stripped and the
// body values blanked first: an unanchored scan reads a ` -t ` from an earlier
// command in a compound (`mktemp -t`), and a `--title` mentioned inside a body
// string, as the PR title.
export function extractTitle(command: string): string | null {
  const text = parseCommand(command).text;
  const start = text.search(PR_BODY_COMMAND_PATTERN);
  const flags = bodyFlags(text);
  const scope = (start === -1 ? text : text.slice(start))
    .replace(flagValuePattern(flags.file, true), " ")
    .replace(flagValuePattern(flags.inline, true), " ");
  const value = scope.match(/(?:--title|(?<![\w-])-t)[=\s]("(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+)/)?.[1];
  if (value == null || value === "") return null;
  return unescapeDoubleQuoted(unquote(value));
}

function bullets(reasons: string[]): string {
  return reasons.map((reason) => `- ${reason}`).join("\n");
}

// A deny reason carries an exact fix, so the whole set is worth reporting at
// once: the model would otherwise rewrite the body, retry, and be blocked again
// by the next one. Warnings ride along on a deny for the same reason.
function decide(denies: string[], warns: string[]): SyncHookJSONOutput | null {
  if (denies.length > 0) {
    const alsoWorth =
      warns.length > 0 ? `\nAlso worth addressing in the same edit:\n${bullets(warns)}` : "";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Fix the PR body before retrying:\n${bullets(denies)}${alsoWorth}`,
      },
    };
  }
  if (warns.length === 0) {
    return null;
  }
  const intro =
    warns.length === 1
      ? "This PR has a structural-slop pattern:"
      : "This PR has structural-slop patterns:";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `${intro}\n${bullets(warns)}`,
    },
  };
}

// Patterns with a mechanical fix the body can't argue its way out of.
function denyReasons(body: string): string[] {
  const reasons: string[] = [];
  if (TEST_COUNT_PATTERN.test(body)) {
    reasons.push(
      "Testing section should not mention test counts. Describe what is covered instead.",
    );
  }
  const headingViolations = headingCaseViolations(body);
  if (headingViolations.length > 0) {
    const suggestions = headingViolations
      .map((violation) => `"${violation.text}" → "${violation.suggested}"`)
      .join("; ");
    reasons.push(
      `Section headings should use AP title case. Apply: ${suggestions}. A heading that is intentionally cased (proper noun, code identifier) can be reworded so it satisfies AP case.`,
    );
  }
  if (hasBacktickedRef(body)) {
    reasons.push(AUTOLINK_REASON);
  }
  return reasons;
}

export interface BodyContext {
  /** Title the command sets, or null when it sets none. */
  title: string | null;
  /** The repo is owned by the authenticated user, so the PR is self-reviewed. */
  personalRepo: boolean;
}

const NO_CONTEXT: BodyContext = { title: null, personalRepo: false };

// Patterns whose fix is a judgment call, so the author gets the note and keeps
// the decision.
function warnReasons(body: string, context: BodyContext): string[] {
  const reasons: string[] = [];
  if (hasReflexiveScaffold(body)) {
    reasons.push(
      "Small PRs don't need a `## Changes` + `## Testing` scaffold. Length tracks substance. Use prose for a short change.",
    );
  }
  if (hasFileTourBullets(body)) {
    reasons.push(
      "Bullets shaped like `- **path/to/file**: ...` narrate a file tour. Describe the conceptual change instead of walking the diff file by file.",
    );
  }
  if (hasCiStatusRollCall(body)) {
    reasons.push(
      "The body states that lint, types, tests, or a build passed. The PR's status checks already show that. Drop it, unless the result is one CI won't post: a manual check CI doesn't run, an intentional exclusion, or a pre-existing warning you're leaving in place.",
    );
  }
  if (hasRunOnProse(body)) {
    reasons.push(
      "A prose paragraph runs long: over four sentences, a sentence past 280 characters, or several clauses stacked behind commas. Split the thread, or move an enumeration into a list.",
    );
  }
  const tells = findNarrationTells(body);
  if (tells.length > 0) {
    const quoted = tells.map((tell) => `"${tell}"`).join(", ");
    reasons.push(
      `The body narrates its own writing (${quoted}). A reader who was not in the session cannot tell a deliberate choice from an accidental one, and saying a fact is worth noting is not the same as stating it. Drop the framing and keep the fact.`,
    );
  }
  const sentenceHeadings = sentenceShapedHeadings(body);
  if (sentenceHeadings.length > 0) {
    const detail = sentenceHeadings
      .map((heading) => `"${heading.text}" (${heading.signals.join("; ")})`)
      .join(", ");
    reasons.push(
      `Headings read as sentences instead of labels: ${detail}. A heading names its section. Move the claim into the prose under it.`,
    );
  }
  if (context.personalRepo) {
    const words = countProseWords(body);
    if (words > PERSONAL_BODY_WORD_LIMIT) {
      reasons.push(
        `The body runs ${words} words on a repo you own and merge yourself. Nobody else is reading this. Keep what you would want on a bisect six months out and cut the rest.`,
      );
    }
  }
  if (context.title !== null) {
    if (context.title.length > TITLE_LENGTH_LIMIT) {
      reasons.push(
        `The title runs ${context.title.length} characters. Under ${TITLE_LENGTH_LIMIT} keeps it readable in a PR list and in \`git log --oneline\`.`,
      );
    }
    if (hasClauseStacking(context.title)) {
      reasons.push(
        "The title enumerates several changes. Name the change the PR makes and leave the parts to the body.",
      );
    }
  }
  return reasons;
}

export function validateBody(
  body: string,
  context: BodyContext = NO_CONTEXT,
): SyncHookJSONOutput | null {
  return decide(denyReasons(body), warnReasons(body, context));
}

// A body the hook cannot read is not a body without problems. Every check below
// runs on the body text, so an unresolvable one silently skips all of them, and
// the command sails through looking validated. The deny names the readable form
// instead, which is a path either CLI accepts.
export function unreadableBodyReason(detail: string): string {
  return `The hook cannot read ${detail}, so none of the body checks ran. Write the body to a file with a quoted heredoc (\`cat > <path> <<'EOF'\`), in the same call or its own, then pass that path: \`--body-file <path>\` on \`gh\`, \`--description-file <path>\` on \`glab\`.`;
}

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  const command = BashInput.safeParse(input.tool_input).data?.command;

  if (command === undefined || !isPrBodyCommand(command)) {
    return null;
  }

  const cwd = input.cwd ?? process.cwd();
  const title = extractTitle(command);
  const resolved = await resolveBody(command, cwd);

  if (resolved.kind === "unreadable") {
    return decide(
      [unreadableBodyReason(resolved.detail)],
      warnReasons("", { title, personalRepo: false }),
    );
  }

  // A title-only command (`gh pr edit --title ...`) still gets its title
  // checked.
  if (resolved.kind === "none") {
    if (title === null) return null;
    return decide([], warnReasons("", { title, personalRepo: false }));
  }

  const body = resolved.text;
  const denies = denyReasons(body);
  const repoCwd = effectiveCwd(command, cwd);

  if (!denies.includes(AUTOLINK_REASON)) {
    const candidates = extractBacktickedHexCandidates(body);
    const commits = await findBacktickedCommits(candidates, gitCommitVerifier(repoCwd));
    if (commits.length > 0) {
      denies.push(AUTOLINK_REASON);
    }
  }

  let personalRepo = false;
  if (isLongBody(body)) {
    const [remote, hosts] = await Promise.all([readGitRemote(repoCwd), readGhHosts()]);
    personalRepo = isPersonalRepo(remote, hosts);
  }

  return decide(denies, warnReasons(body, { title, personalRepo }));
}
