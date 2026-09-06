#!/usr/bin/env bun

import { globSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { getDefaultBranch } from "./default-branch";
import { BashInput, PreToolUse } from "./hook-input";

// Flags git accepts between the executable and its subcommand. Enumerated
// rather than matched as a generic `-\S+` so that a value which happens to be
// the word `commit` (`git log --grep commit`) cannot be read as the subcommand.
const VALUE_FLAG = String.raw`(?:-[cC]|--(?:git-dir|work-tree|namespace|exec-path|config-env))(?:=\S+|\s+\S+)`;
const BOOLEAN_FLAG =
  "--(?:no-pager|paginate|bare|literal-pathspecs|no-replace-objects|no-optional-locks)";
const GIT_COMMIT_PATTERN = new RegExp(
  String.raw`\bgit\s+(?:(?:${VALUE_FLAG}|${BOOLEAN_FLAG})\s+)*commit(?![\w-])`,
);

// Quoted strings and `((...))` or `$((...))` arithmetic, where `<<` and
// `git commit` are data. Masking with spaces keeps offsets aligned with the
// unmasked text.
const INERT_SPAN = /'[^']*'|"(?:[^"\\]|\\.)*"|\$?\(\((?:[^)]|\)(?!\)))*\)\)/g;

function maskQuoted(command: string): string {
  return command.replace(INERT_SPAN, (span) => " ".repeat(span.length));
}

// Runs `lead` over the quote-masked text, so a match cannot start inside a
// string, then reads `tail` from the unmasked text where each lead ends, so a
// quoted operand still comes through.
function* unquotedMatches(
  text: string,
  lead: RegExp,
  tail: RegExp,
): Generator<{ at: number; match: RegExpMatchArray }> {
  for (const match of maskQuoted(text).matchAll(lead)) {
    const at = match.index + match[0].length;
    const rest = text.slice(at).match(tail);
    if (rest !== null) yield { at, match: rest };
  }
}

// A heredoc operator, then its delimiter word, which the shell takes as any
// word up to the next operator or space and reads with its quotes removed.
// The lookarounds keep `<<<` herestrings and an escaped `\<<` out.
const HEREDOC_LEAD = /(?<![<\\])<<(?!<)/g;
const HEREDOC_DELIMITER = /^(-?)[ \t]*((?:'[^']*'|"[^"]*"|\\.|[^\s'"\\<>|&;()])+)/;

function unquoteWord(word: string): string {
  return word.replaceAll(/'([^']*)'|"([^"]*)"|\\(.)/g, (_, single, double, escaped) =>
    String(single ?? double ?? escaped),
  );
}

// A `#` that starts a word, after space or an operator, opens a comment the
// shell never parses, so nothing after it is syntax.
const COMMENT_START = /(?:^|[\s;&|(])#/;

function withoutComment(line: string): string {
  const start = maskQuoted(line).search(COMMENT_START);
  return start === -1 ? line : line.slice(0, start);
}

// Line-oriented heredoc scan: a body runs from the line after its operator to
// the delimiter line, and several operators on one line consume bodies in
// order. An unterminated heredoc owns the rest of the command.
function stripHeredocs(command: string): string {
  const kept: string[] = [];
  const pending: Array<{ delimiter: string; stripTabs: boolean }> = [];
  for (const raw of command.split("\n")) {
    const open = pending[0];
    if (open !== undefined) {
      if ((open.stripTabs ? raw.replace(/^\t+/, "") : raw) === open.delimiter) pending.shift();
      continue;
    }
    const line = withoutComment(raw);
    kept.push(line);
    for (const { match } of unquotedMatches(line, HEREDOC_LEAD, HEREDOC_DELIMITER)) {
      pending.push({ delimiter: unquoteWord(match[2] ?? ""), stripTabs: match[1] === "-" });
    }
  }
  return kept.join("\n");
}

export function invokesGitCommit(command: string): boolean {
  return GIT_COMMIT_PATTERN.test(maskQuoted(stripHeredocs(command)));
}

// A `cd` ahead of the commit moves where git resolves the branch. The lead-in
// excludes `||`, whose cd only runs when the one before it failed. The
// terminator excludes a cd that runs in its own process behind `|` or `&`, or
// whose subshell closes with `)` right after it.
const CD_LEAD = /(?:^|&&|;|\n|\(|`)\s*cd(?=\s)/g;
const CD_TARGET = /^\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&)]+)\s*(?=&&|\|\||;|\n|$)/;
const SHELL_EXPANSION_PATTERN = /(?<!\\)[$`]/;
const GLOB_PATTERN = /(?<!\\)[*?[]/;
const BACKTICK = /(?<!\\)`/g;
const EVERY_GIT_COMMIT = new RegExp(GIT_COMMIT_PATTERN, "g");

function unquote(value: string): string {
  return value.match(/^(['"])(.*)\1$/s)?.[2] ?? value;
}

// A cd inside a subshell or `$(...)` stops applying once more `)` than `(`
// follow it, and one inside backticks once the closing backtick does.
function subshellClosed(masked: string, from: number): boolean {
  const rest = masked.slice(from);
  const inBackticks = (masked.slice(0, from).match(BACKTICK)?.length ?? 0) % 2 === 1;
  if (inBackticks && rest.search(BACKTICK) !== -1) return true;
  let depth = 0;
  for (const char of rest) {
    if (char === "(") depth++;
    if (char === ")" && --depth < 0) return true;
  }
  return false;
}

function isDirectory(path: string): boolean {
  try {
    readdirSync(realpathSync(path));
    return true;
  } catch {
    return false;
  }
}

// The directory a cd word names on disk, if it names exactly one path and
// that path is a directory. A glob that also matches a file gives cd too many
// operands.
function directoriesNamed(path: string, quoted: boolean): string[] {
  const candidates = !quoted && GLOB_PATTERN.test(path) ? globSync(path) : [path];
  return candidates.length === 1 ? candidates.filter(isDirectory) : [];
}

type Expand = (path: string, quoted: boolean) => string[];

function directoryBefore(scope: string, cwd: string, expand: Expand): string {
  const masked = maskQuoted(scope);
  let dir = cwd;
  for (const { at, match } of unquotedMatches(scope, CD_LEAD, CD_TARGET)) {
    if (subshellClosed(masked, at)) continue;
    const word = match[1] ?? "";
    const target = unquote(word);
    const quoted = word !== target;
    if (target === "" || target === "-" || SHELL_EXPANSION_PATTERN.test(target)) return cwd;
    let next = isAbsolute(target) ? target : join(dir, target);
    // A quoted tilde is literal. `~user` needs a passwd lookup the hook does not do.
    if (word.startsWith("~")) {
      if (target !== "~" && !target.startsWith("~/")) return cwd;
      next = join(homedir(), target.slice(1));
    }
    // A cd into a missing path, a file, or a glob naming several directories
    // fails and leaves the shell where it was.
    const [found, ...others] = expand(next, quoted);
    if (found !== undefined && others.length === 0) dir = found;
  }
  return dir;
}

/** Directory each commit in the command runs in after the `cd`s the hook can evaluate, or `cwd` where one cannot be. */
export function commitDirectories(
  command: string,
  cwd: string,
  expand: Expand = directoriesNamed,
): string[] {
  const text = stripHeredocs(command);
  return [...maskQuoted(text).matchAll(EVERY_GIT_COMMIT)].map((commit) =>
    directoryBefore(text.slice(0, commit.index), cwd, expand),
  );
}

// One rev-parse yields both the repo root (cache key) and current branch. A
// non-zero exit means we're outside a repo, and the spawn itself throws when
// `dir` is not a directory.
async function revParse(dir: string): Promise<string | null> {
  try {
    const rev = await $`git rev-parse --show-toplevel --abbrev-ref HEAD`.cwd(dir).quiet().nothrow();
    return rev.exitCode === 0 ? rev.text() : null;
  } catch {
    return null;
  }
}

export function formatDenyOutput(branch: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Cannot commit directly to ${branch}. Create a topic branch first with: git checkout -b <branch-name>`,
    },
  };
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  // The `Bash(git commit:*)` condition only narrows which calls spawn this hook.
  // It fails open on shell metacharacters, so the deny decision rests on the
  // command this hook reads for itself.
  const command = BashInput.safeParse(input.tool_input).data?.command;
  if (command == null || command === "" || !invokesGitCommit(command)) {
    return null;
  }

  // The hook process is spawned in the session's directory, which is not where
  // the Bash command runs: a subagent working in a worktree reports that
  // worktree as `input.cwd`, and a leading `cd` moves the command again before
  // git runs. Resolving the branch anywhere else reads the wrong repo.
  const dirs = commitDirectories(command, input.cwd);
  const branches = await Promise.all([...new Set(dirs)].map(defaultBranchCheckedOut));
  const branch = branches.find((name) => name !== null);
  return branch == null ? null : formatDenyOutput(branch);
}

// The default branch when `dir` sits on it, else null: outside a repo,
// detached ("HEAD"), or on another branch.
async function defaultBranchCheckedOut(dir: string): Promise<string | null> {
  const rev = await revParse(dir);
  if (rev === null) return null;
  const [repoRoot, currentBranch] = rev.trim().split("\n");
  if (
    repoRoot == null ||
    repoRoot === "" ||
    currentBranch == null ||
    currentBranch === "" ||
    currentBranch === "HEAD"
  ) {
    return null;
  }
  const defaultBranch = await getDefaultBranch(dir, repoRoot);
  return defaultBranch != null && defaultBranch === currentBranch ? defaultBranch : null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = PreToolUse.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[git/block-default-branch-commit] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
