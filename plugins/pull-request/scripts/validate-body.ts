import { homedir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { headingCaseViolations } from "./heading-case";
import { LINKING_VERBS } from "./linguistics/heading";
import { countProseWords, headingTexts, linesOutsideFences, stripEmphasis } from "./markdown";
import { classifyPrHeading } from "./sentence-heading";

function hasBashCommand(input: unknown): input is { command: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof (input as { command: unknown }).command === "string"
  );
}

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
    if (label && looksLikeFilePath(label)) return true;
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
    const match = line.match(/^\s+user:\s*(.+?)\s*$/);
    if (match?.[1]) return match[1].replace(/^["']|["']$/g, "");
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
// the check in-script so the validator is inert under any other dispatch.
const PR_BODY_COMMAND_PATTERN = /\b(?:gh pr (?:create|edit)|glab mr (?:create|update))\b/;

export function isPrBodyCommand(command: string): boolean {
  return PR_BODY_COMMAND_PATTERN.test(command);
}

function unquote(value: string): string {
  const match = value.match(/^(['"])(.*)\1$/s);
  return match?.[2] ?? value;
}

export function extractBodyFilePath(command: string): string | null {
  const match = command.match(/--body-file[=\s]("[^"]+"|'[^']+'|[^\s]+)/);
  if (!match?.[1]) return null;
  const path = unquote(match[1]);
  const tmpdir = process.env.TMPDIR?.replace(/\/$/, "");
  if (!tmpdir) return path;
  return path.replace(/\$\{TMPDIR\}|\$TMPDIR/g, tmpdir);
}

// Inline bodies are a small share of invocations but bypass the file path
// entirely. Only quoted forms are read: an unquoted `--body` value is a single
// shell word, so it cannot hold the headings this validates.
export function extractInlineBody(command: string): string | null {
  const match = command.match(/(?:--body|(?<!\w)-b)[=\s]("(?:[^"\\]|\\.)*"|'[^']*')/);
  if (!match?.[1]) return null;
  const raw = unquote(match[1]);
  return raw.replace(/\\(["`$\\])/g, "$1");
}

// Anchored to the `gh pr`/`glab mr` verb with the body values blanked first:
// an unanchored scan reads a ` -t ` from an earlier command in a compound
// (`mktemp -t`), and a `--title` mentioned inside an inline `--body` string,
// as the PR title.
export function extractTitle(command: string): string | null {
  const start = command.search(PR_BODY_COMMAND_PATTERN);
  const scope = (start === -1 ? command : command.slice(start))
    .replace(/(?:--body|(?<!\w)-b)[=\s]("(?:[^"\\]|\\.)*"|'[^']*')/g, " ")
    .replace(/--body-file[=\s]("[^"]+"|'[^']+'|[^\s]+)/g, " ");
  const match = scope.match(/(?:--title|(?<![\w-])-t)[=\s]("(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+)/);
  if (!match?.[1]) return null;
  return unquote(match[1]).replace(/\\(["`$\\])/g, "$1");
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

async function resolveBody(command: string): Promise<string | null> {
  const bodyFilePath = extractBodyFilePath(command);
  if (bodyFilePath) {
    try {
      return await Bun.file(bodyFilePath).text();
    } catch {
      return null;
    }
  }
  return extractInlineBody(command);
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  if (!hasBashCommand(input.tool_input)) {
    return null;
  }
  const { command } = input.tool_input;

  if (!isPrBodyCommand(command)) {
    return null;
  }

  const title = extractTitle(command);
  const body = await resolveBody(command);

  // A title-only command (`gh pr edit --title ...`, or a --body-file not yet
  // written at PreToolUse time) still gets its title checked.
  if (body === null) {
    if (title === null) return null;
    return decide([], warnReasons("", { title, personalRepo: false }));
  }

  const cwd = input.cwd ?? process.cwd();
  const denies = denyReasons(body);

  if (!denies.includes(AUTOLINK_REASON)) {
    const candidates = extractBacktickedHexCandidates(body);
    const commits = await findBacktickedCommits(candidates, gitCommitVerifier(cwd));
    if (commits.length > 0) {
      denies.push(AUTOLINK_REASON);
    }
  }

  let personalRepo = false;
  if (isLongBody(body)) {
    const [remote, hosts] = await Promise.all([readGitRemote(cwd), readGhHosts()]);
    personalRepo = isPersonalRepo(remote, hosts);
  }

  return decide(denies, warnReasons(body, { title, personalRepo }));
}
