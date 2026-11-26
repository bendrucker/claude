#!/usr/bin/env bun

import { dirname, isAbsolute, join, resolve } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  type Command,
  commandsOf,
  hasFlag,
  isDescendant,
  isProgram,
  parseCommands,
  positionals,
} from "./command-segments";
import { bashCommand, isPreToolUse, readHookInput } from "./hook-input";

export type HookInput = PreToolUseHookInput;

// The <session_id> "loaded" marker is written by the bang-execution line in
// skills/merge-request/SKILL.md. Keep the path in sync with that command.
export const MARKER_DIR = "/tmp/claude/gitlab-skill";

// The Bash tool's shell has no CLAUDE_PLUGIN_ROOT to expand.
const WATCH_SCRIPT = join(import.meta.dirname, "..", "skills/ci-monitor/scripts/watch.ts");

export interface LintEnv {
  fileExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string | null>;
  touch(path: string): Promise<void>;
}

export const defaultEnv: LintEnv = {
  fileExists: (path) => Bun.file(path).exists(),
  readFile: async (path) => {
    try {
      return await Bun.file(path).text();
    } catch {
      // A missing or unreadable marker must not fail the hook. Treat it as absent.
      return null;
    }
  },
  touch: async (path) => {
    try {
      await Bun.write(path, "");
    } catch {
      // fail open: the nudge just repeats next time
    }
  },
};

function deny(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function context(text: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: text,
    },
  };
}

function glabCommands(commands: Command[]): Command[] {
  return commandsOf(commands, "glab");
}

function heredocText(command: Command, commands: Command[]): string[] {
  const holders = [command, ...commands.filter((other) => isDescendant(other, command))];
  return holders.flatMap((holder) => holder.heredocs.map((heredoc) => heredoc.body));
}

function usesEscapedDollar(command: Command, commands: Command[]): boolean {
  const inlineQuery = command.args.some(
    ({ text, quote }) =>
      text.startsWith("query=") &&
      text.includes(String.raw`\$`) &&
      (quote === "single" || quote === "mixed"),
  );
  if (inlineQuery) return true;
  const holders = [command, ...commands.filter((other) => isDescendant(other, command))];
  return holders.some((holder) =>
    holder.heredocs.some((heredoc) => heredoc.quoted && heredoc.body.includes(String.raw`\$`)),
  );
}

export function lintGlab(commands: Command[]): string | null {
  for (const command of glabCommands(commands)) {
    const [area, sub] = positionals(command);
    if (area === "api" && hasFlag(command, "--jq", "-q")) {
      return "glab api has no --jq/-q (glab mr view, ci get, etc. accept --jq, api does not). Pipe instead: glab api <endpoint> | jq '<filter>'";
    }
    if (hasFlag(command, "--json")) {
      return "glab has no --json flag (that's gh). Use --output json.";
    }

    if (area !== "api" || sub !== "graphql") continue;
    if (usesEscapedDollar(command, commands)) {
      return [
        String.raw`Escaped dollars (\$) corrupt GraphQL variable declarations. Pass the query via a quoted heredoc so $ needs no escaping:`,
        `glab api graphql -f query="$(cat <<'GQL'`,
        "mutation($projectPath: ID!, $iid: String!) { ... }",
        "GQL",
        ')" -f projectPath=<group/project> -f iid=<iid>',
      ].join("\n");
    }
    const text = [...command.args.map((arg) => arg.text), ...heredocText(command, commands)].join(
      "\n",
    );
    if (text.includes("mergeRequestSetAutoMerge")) {
      return "mergeRequestSetAutoMerge does not exist in GitLab's GraphQL schema. Auto-merge is REST-only: use the gitlab:merge-request skill's merge.ts (handles merge trains) or glab mr merge --auto-merge.";
    }
    if (text.includes("mergeRequestRequestReview")) {
      return "mergeRequestRequestReview does not exist in GitLab's GraphQL schema. To re-request a review, post a note holding the quick action: glab mr note create <iid> -m '/request_review @user'. To request changes use mergeRequestRequestChanges. See the gitlab:merge-request skill.";
    }
  }
  return null;
}

// gh api, curl, and Claude Code's own @-mentions read `@<path>` as a file. glab
// sends it literally, so a note posts as the bare path. Only `glab api -F`
// reads the file.
const FILE_PATH = String.raw`@((?:[~/.]|\$)\S*|\S+\.(?:md|markdown|txt))`;
const FILE_VALUE = new RegExp(`^${FILE_PATH}$`);
const RAW_FIELD_VALUE = new RegExp(String.raw`^([\w.[\]]+)=${FILE_PATH}$`);
const FLAG_WITH_VALUE = /^(-\w|--[a-z][\w-]*)=([^]*)$/;
const FLAG_ONLY = /^(?:-\w|--[a-z][\w-]*)$/;

interface FlagValue {
  flag: string;
  value: string;
}

function flagValues(command: Command): FlagValue[] {
  const result: FlagValue[] = [];
  const words = command.args.map((arg) => arg.text);
  for (const [index, word] of words.entries()) {
    const joined = word.match(FLAG_WITH_VALUE);
    const next = words[index + 1];
    if (joined?.[1] !== undefined && joined[2] !== undefined) {
      result.push({ flag: joined[1], value: joined[2] });
    } else if (FLAG_ONLY.test(word) && next !== undefined) {
      result.push({ flag: word, value: next });
    }
  }
  return result;
}

function fileReferenceReason(command: Command, path: string): string {
  const [area, sub] = positionals(command);
  const literal = `glab does not read @<file> arguments: this would post the literal text "@${path}".`;
  if ((area === "mr" || area === "issue") && sub === "note") {
    const form = area === "mr" ? "glab mr note create <iid>" : "glab issue note <iid>";
    return `${literal} Send the file on stdin: ${form} < ${path}`;
  }
  if ((area === "mr" || area === "issue") && (sub === "create" || sub === "update")) {
    return `${literal} Use --description-file ${path} (or - for stdin).`;
  }
  return `${literal} Pass the contents instead, e.g. "$(cat ${path})".`;
}

export function lintFileReference(commands: Command[]): string | null {
  for (const command of glabCommands(commands)) {
    const [area] = positionals(command);
    for (const { flag, value } of flagValues(command)) {
      if (area === "api") {
        const raw = flag === "-f" || flag === "--raw-field" ? value.match(RAW_FIELD_VALUE) : null;
        if (raw) {
          return `glab api -f sends "@${raw[2]}" as the literal value of ${raw[1]}. Use -F ${raw[1]}=@${raw[2]}, which reads the file.`;
        }
        continue;
      }
      const path = value.match(FILE_VALUE)?.at(1);
      if (path != null) return fileReferenceReason(command, path);
    }
  }
  return null;
}

function remoteHost(url: string): string | null {
  const scheme = url.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i);
  if (scheme) return scheme[1] ?? null;
  const ssh = url.match(/^(?:[^@\s]+@)([^:/\s]+):/);
  if (ssh) return ssh[1] ?? null;
  return null;
}

function isGitLabHost(host: string): boolean {
  return host.split(".").includes("gitlab");
}

async function pointerConfigPath(
  dir: string,
  pointer: string,
  env: LintEnv,
): Promise<string | null> {
  const gitdir = pointer.match(/^gitdir:\s*(.+)\s*$/m)?.at(1);
  if (gitdir == null || gitdir === "") return null;

  const gitDir = isAbsolute(gitdir) ? gitdir : resolve(dir, gitdir);
  for (const candidate of [
    join(gitDir, "config"),
    // A linked worktree's gitdir is <main>/.git/worktrees/<name>.
    // The shared config lives two levels up.
    resolve(gitDir, "..", "..", "config"),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- first match wins: the shared config is only probed when the direct one misses.
    if (await env.fileExists(candidate)) return candidate;
  }
  return null;
}

async function gitConfigPath(cwd: string, env: LintEnv): Promise<string | null> {
  let dir = cwd;
  for (;;) {
    const dotGit = join(dir, ".git");
    const direct = join(dotGit, "config");
    // oxlint-disable-next-line no-await-in-loop -- walks up to the parent directory only after the current one misses.
    if (await env.fileExists(direct)) return direct;

    // Worktrees and submodules use a `.git` file: `gitdir: <path>`.
    // oxlint-disable-next-line no-await-in-loop -- walks up to the parent directory only after the current one misses.
    const pointer = await env.readFile(dotGit);
    if (pointer != null && pointer !== "") return pointerConfigPath(dir, pointer, env);

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function originHost(cwd: string, env: LintEnv): Promise<string | null> {
  const configPath = await gitConfigPath(cwd, env);
  if (configPath == null || configPath === "") return null;
  const config = await env.readFile(configPath);
  if (config == null || config === "") return null;
  const section = config.match(/\[remote "origin"\]([^[]*)/)?.at(1);
  if (section == null || section === "") return null;
  const url = section.match(/^\s*url\s*=\s*(.+)\s*$/m)?.at(1);
  if (url == null || url === "") return null;
  return remoteHost(url.trim());
}

export async function lintGh(
  commands: Command[],
  cwd: string,
  env: LintEnv,
): Promise<string | null> {
  const redirected = (index: number): boolean =>
    commands
      .slice(0, index)
      .some(
        (earlier) =>
          earlier.program === "cd" ||
          earlier.program === "pushd" ||
          (isProgram(earlier, "git") && hasFlag(earlier, "-C")),
      );
  const targetsOrigin = commands.some((command, index) => {
    if (!isProgram(command, "gh")) return false;
    const [area] = positionals(command);
    if (area !== "pr" && area !== "issue") return false;
    if (hasFlag(command, "-R", "--repo")) return false;
    if (command.assignments.some((assignment) => assignment.startsWith("GH_REPO="))) return false;
    if (command.args.some(({ text }) => text.includes("github.com"))) return false;
    return !redirected(index);
  });
  if (!targetsOrigin) return null;

  const host = await originHost(cwd, env);
  if (host != null && host !== "" && isGitLabHost(host)) {
    return `This repository's origin remote is GitLab (${host}). gh cannot resolve it; use glab instead, and load gitlab:merge-request for MR workflows (or pass -R <owner>/<repo> if you really meant a GitHub repo).`;
  }
  return null;
}

const READ_ONLY_NOTE = new Set(["list"]);

function isTransactional(command: Command): boolean {
  if (!isProgram(command, "glab")) return false;
  if (hasFlag(command, "--help", "-h")) return false;
  const [area, sub, third] = positionals(command);
  if (area === "mr") {
    if (sub === "create" || sub === "merge" || sub === "update") return true;
    if (sub === "note") return !READ_ONLY_NOTE.has(third ?? "");
    return false;
  }
  if (area === "api") {
    return command.args.some(
      ({ text }) => text.includes("merge_trains") || text.includes("draft_notes"),
    );
  }
  return false;
}

async function nudgeOnce(
  marker: string,
  sessionId: string,
  text: string,
  env: LintEnv,
  skipWhenLoaded: boolean,
): Promise<SyncHookJSONOutput | null> {
  const loaded = join(MARKER_DIR, sessionId);
  const nudged = join(MARKER_DIR, `${sessionId}.${marker}`);
  if (skipWhenLoaded && (await env.fileExists(loaded))) return null;
  if (await env.fileExists(nudged)) return null;
  await env.touch(nudged);
  return context(text);
}

export async function nudgeSkill(
  commands: Command[],
  sessionId: string,
  env: LintEnv,
): Promise<SyncHookJSONOutput | null> {
  if (!commands.some(isTransactional)) return null;
  return nudgeOnce(
    "nudged",
    sessionId,
    "This command transacts on a merge request but the gitlab:merge-request skill is not loaded. Load it first: it owns merge trains, auto-merge re-arming, draft notes, discussions, and reviewer/username resolution, and its scripts avoid known glab API pitfalls.",
    env,
    true,
  );
}

function queriesPipelineState(command: Command): boolean {
  if (!isProgram(command, "glab")) return false;
  const [area, sub] = positionals(command);
  if (area === "ci") return sub === "status" || sub === "get" || sub === "list";
  if (area === "mr") return sub === "view";
  if (area === "api") {
    return command.args.some(
      ({ text }) =>
        /\/pipelines(?:\/|\?|$)/.test(text) || /\/merge_requests\/\d+(?:\?|$)/.test(text),
    );
  }
  return false;
}

function pollsInLoop(commands: Command[]): boolean {
  if (commands.some((command) => command.program === "sleep")) return true;
  if (commands.some((command) => command.keywords.some((k) => k === "until" || k === "while"))) {
    return true;
  }
  return commands.some(
    (command) =>
      command.program === "for" &&
      (commands.some((other) => other.program === "seq" && isDescendant(other, command)) ||
        command.args.some(({ text }) => /\{\d+\.\.\d+\}/.test(text))),
  );
}

export async function nudgePolling(
  commands: Command[],
  sessionId: string,
  env: LintEnv,
): Promise<SyncHookJSONOutput | null> {
  if (!commands.some(queriesPipelineState) || !pollsInLoop(commands)) return null;
  return nudgeOnce(
    "polling",
    sessionId,
    `Polling GitLab CI in a shell loop. Run the watcher under the Monitor tool with persistent: true instead: bun "${WATCH_SCRIPT}" with --mr <url> (also reports conflicts and mergeable-unknown), --branch <name>, or --pipeline-id <id>. It emits one event per state change, so the session is not blocked on sleep.`,
    env,
    false,
  );
}

export async function processInput(
  input: HookInput,
  env: LintEnv = defaultEnv,
): Promise<SyncHookJSONOutput | null> {
  const command = bashCommand(input.tool_input);
  if (command == null) return null;
  if (!command.includes("glab") && !/(^|\s)gh\s/.test(command)) return null;

  const commands = parseCommands(command);

  if (command.includes("glab")) {
    const violation = lintGlab(commands) ?? lintFileReference(commands);
    if (violation != null && violation !== "") return deny(violation);
  }

  if (commands.some((parsed) => isProgram(parsed, "gh"))) {
    const violation = await lintGh(commands, input.cwd, env);
    if (violation != null && violation !== "") return deny(violation);
  }

  if (command.includes("glab")) {
    return (
      (await nudgeSkill(commands, input.session_id, env)) ??
      (await nudgePolling(commands, input.session_id, env))
    );
  }

  return null;
}

async function main(): Promise<void> {
  const input = await readHookInput(isPreToolUse, "lint");
  if (input == null) return;

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
