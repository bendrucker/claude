#!/usr/bin/env bun

import { realpathSync } from "node:fs";
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

const QUOTED_SPAN = /'[^']*'|"(?:[^"\\]|\\.)*"/g;

// A heredoc operator with its delimiter word. The lookbehind keeps `<<<`
// herestrings out.
const HEREDOC_OPERATOR = /(?<!<)<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g;

// Quoted spans can hold the literal text `git commit` as inert data, in commit
// messages or grep patterns. Masking with spaces keeps offsets aligned with
// the unmasked text.
function maskQuoted(command: string): string {
  return command.replace(QUOTED_SPAN, (span) => " ".repeat(span.length));
}

function quotedSpans(line: string): Array<[number, number]> {
  return [...line.matchAll(QUOTED_SPAN)].map((m) => [m.index, m.index + m[0].length]);
}

// Line-oriented heredoc scan: a body runs from the line after its operator to
// the delimiter line, and several operators on one line consume bodies in
// order. An unterminated heredoc owns the rest of the command.
function stripHeredocs(command: string): string {
  const kept: string[] = [];
  const pending: Array<{ delimiter: string; stripTabs: boolean }> = [];
  for (const line of command.split("\n")) {
    const open = pending[0];
    if (open !== undefined) {
      if ((open.stripTabs ? line.replace(/^\t+/, "") : line) === open.delimiter) pending.shift();
      continue;
    }
    kept.push(line);
    const spans = quotedSpans(line);
    for (const match of line.matchAll(HEREDOC_OPERATOR)) {
      if (spans.some(([start, end]) => match.index > start && match.index < end)) continue;
      pending.push({
        delimiter: match[2] ?? match[3] ?? match[4] ?? "",
        stripTabs: match[1] === "-",
      });
    }
  }
  return kept.join("\n");
}

function shellSyntax(command: string): string {
  return maskQuoted(stripHeredocs(command));
}

export function invokesGitCommit(command: string): boolean {
  return GIT_COMMIT_PATTERN.test(shellSyntax(command));
}

// A `cd` ahead of the commit moves where git resolves the branch. `||` is
// excluded from the lead-ins: a `cd a || cd b` fallback only runs when the
// first cd failed, so the hook follows the success path.
const CD_PATTERN = /(?:^|&&|;|\n)\s*cd\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&]+)/g;
const SHELL_EXPANSION_PATTERN = /(?<!\\)[$`]/;

function unquote(value: string): string {
  return value.match(/^(['"])(.*)\1$/s)?.[2] ?? value;
}

function existingDirectory(target: string, fallback: string): string {
  try {
    return realpathSync(target);
  } catch {
    return fallback;
  }
}

/** Directory the commit runs in after every `cd` the hook can evaluate, or `cwd` when one cannot be. */
export function effectiveCwd(command: string, cwd: string): string {
  const text = stripHeredocs(command);
  const start = maskQuoted(text).search(GIT_COMMIT_PATTERN);
  const scope = start === -1 ? text : text.slice(0, start);
  let dir = cwd;
  for (const match of scope.matchAll(CD_PATTERN)) {
    const target = unquote(match[1] ?? "");
    if (target === "" || target === "-" || SHELL_EXPANSION_PATTERN.test(target)) return cwd;
    if (target.startsWith("~")) {
      // `~user` needs a passwd lookup the hook does not do.
      if (target !== "~" && !target.startsWith("~/")) return cwd;
      dir = join(homedir(), target.slice(1));
      continue;
    }
    dir = isAbsolute(target) ? target : join(dir, target);
  }
  return dir;
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
  const dir = existingDirectory(effectiveCwd(command, input.cwd), input.cwd);

  // One rev-parse yields both the repo root (cache key) and current branch.
  // A non-zero exit means we're outside a repo; "HEAD" means detached.
  const rev = await $`git rev-parse --show-toplevel --abbrev-ref HEAD`.cwd(dir).quiet().nothrow();
  if (rev.exitCode !== 0) {
    return null;
  }
  const [repoRoot, currentBranch] = rev.text().trim().split("\n");
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
  if (defaultBranch == null || defaultBranch === "") {
    return null;
  }

  if (currentBranch === defaultBranch) {
    return formatDenyOutput(defaultBranch);
  }

  return null;
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
