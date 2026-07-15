#!/usr/bin/env bun

import { dirname, isAbsolute, join, resolve } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

// The <session_id> "loaded" marker is written by the bang-execution line in
// skills/merge-request/SKILL.md. Keep the path in sync with that command.
export const MARKER_DIR = "/tmp/claude/gitlab-skill";

export interface LintEnv {
  fileExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string | null>;
  touch(path: string): Promise<void>;
}

const defaultEnv: LintEnv = {
  fileExists: (path) => Bun.file(path).exists(),
  readFile: async (path) => {
    try {
      return await Bun.file(path).text();
    } catch {
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

// Blank out quoted spans so flag checks never match text inside argument
// values (note bodies, field values), only real flags.
export function stripQuoted(command: string): string {
  return command.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");
}

// Segments approximate one process invocation each, so a `grep -q` elsewhere
// in a pipeline never trips the glab flag checks.
function segments(command: string): string[] {
  return command.split(/\|\|?|&&|;|\n/);
}

export function lintGlab(command: string): string | null {
  for (const segment of segments(stripQuoted(command))) {
    if (!/\bglab\s/.test(segment)) continue;
    if (/\bglab\s+api\b/.test(segment) && /\s(--jq\b|-q(\s|$))/.test(segment)) {
      return "glab api has no --jq/-q output filter (that's gh api). Pipe to jq instead: glab api <endpoint> | jq '<filter>'";
    }
    if (/\s--json\b/.test(segment)) {
      return "glab has no --json flag (that's gh). Use --output json.";
    }
  }

  // GraphQL checks scan raw text (queries live inside quotes), scoped to the
  // segment invoking `glab api graphql` so text in sibling commands (note
  // bodies) never matches. Newlines don't split here: heredoc queries span
  // lines within one invocation.
  for (const segment of command.split(/\|\|?|&&|;/)) {
    if (!/\bglab\s+api\s+graphql\b/.test(segment)) continue;
    if (/query=["']?[^;&|]*\\\$/.test(segment)) {
      return [
        "Escaped dollars (\\$) corrupt GraphQL variable declarations. Pass the query via a quoted heredoc so $ needs no escaping:",
        `glab api graphql -f query="$(cat <<'GQL'`,
        "mutation($projectPath: ID!, $iid: String!) { ... }",
        "GQL",
        ')" -f projectPath=<group/project> -f iid=<iid>',
      ].join("\n");
    }
    if (segment.includes("mergeRequestSetAutoMerge")) {
      return "mergeRequestSetAutoMerge does not exist in GitLab's GraphQL schema. Auto-merge is REST-only: use the gitlab:merge-request skill's merge.ts (handles merge trains) or glab mr merge --auto-merge.";
    }
    if (segment.includes("mergeRequestRequestReview")) {
      return "mergeRequestRequestReview does not exist in GitLab's GraphQL schema. To re-request a review use mergeRequestReviewerRereview; to request changes use mergeRequestRequestChanges. See the gitlab:merge-request skill.";
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

async function gitConfigPath(cwd: string, env: LintEnv): Promise<string | null> {
  let dir = cwd;
  for (;;) {
    const dotGit = join(dir, ".git");
    const direct = join(dotGit, "config");
    if (await env.fileExists(direct)) return direct;

    // Worktrees and submodules use a `.git` file: `gitdir: <path>`.
    const pointer = await env.readFile(dotGit);
    if (pointer) {
      const match = pointer.match(/^gitdir:\s*(.+)\s*$/m);
      if (match?.[1]) {
        const gitDir = isAbsolute(match[1]) ? match[1] : resolve(dir, match[1]);
        for (const candidate of [
          join(gitDir, "config"),
          // A linked worktree's gitdir is <main>/.git/worktrees/<name>.
          // The shared config lives two levels up.
          resolve(gitDir, "..", "..", "config"),
        ]) {
          if (await env.fileExists(candidate)) return candidate;
        }
      }
      return null;
    }

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function originHost(cwd: string, env: LintEnv): Promise<string | null> {
  const configPath = await gitConfigPath(cwd, env);
  if (!configPath) return null;
  const config = await env.readFile(configPath);
  if (!config) return null;
  const section = config.match(/\[remote "origin"\]([^[]*)/);
  if (!section?.[1]) return null;
  const url = section[1].match(/^\s*url\s*=\s*(.+)\s*$/m);
  if (!url?.[1]) return null;
  return remoteHost(url[1].trim());
}

export async function lintGh(command: string, cwd: string, env: LintEnv): Promise<string | null> {
  const targetsOrigin = segments(stripQuoted(command)).some(
    (segment) => /(^|\s)gh\s+(pr|issue)\b/.test(segment) && !/\s(-R|--repo)\b/.test(segment),
  );
  if (!targetsOrigin) return null;

  const host = await originHost(cwd, env);
  if (host && isGitLabHost(host)) {
    return `This repository's origin remote is GitLab (${host}). gh cannot resolve it; use glab instead, and load gitlab:merge-request for MR workflows (or pass -R <owner>/<repo> if you really meant a GitHub repo).`;
  }
  return null;
}

const TRANSACTIONAL = [/\bglab\s+mr\s+(create|merge|update|note)\b/, /merge_trains/, /draft_notes/];

export async function nudgeSkill(
  command: string,
  sessionId: string,
  env: LintEnv,
): Promise<SyncHookJSONOutput | null> {
  if (!TRANSACTIONAL.some((pattern) => pattern.test(command))) return null;

  const loaded = join(MARKER_DIR, sessionId);
  const nudged = join(MARKER_DIR, `${sessionId}.nudged`);
  if ((await env.fileExists(loaded)) || (await env.fileExists(nudged))) return null;

  await env.touch(nudged);
  return context(
    "This command transacts on a merge request but the gitlab:merge-request skill is not loaded. Load it first: it owns merge trains, auto-merge re-arming, draft notes, discussions, and reviewer/username resolution, and its scripts avoid known glab API pitfalls.",
  );
}

export async function processInput(
  input: PreToolUseHookInput,
  env: LintEnv = defaultEnv,
): Promise<SyncHookJSONOutput | null> {
  const command = (input.tool_input as { command?: string }).command;
  if (!command) return null;

  if (command.includes("glab")) {
    const violation = lintGlab(command);
    if (violation) return deny(violation);
  }

  if (/(^|\s)gh\s/.test(command)) {
    const violation = await lintGh(command, input.cwd, env);
    if (violation) return deny(violation);
  }

  if (command.includes("glab")) {
    return nudgeSkill(command, input.session_id, env);
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch {
    return;
  }

  if (input.hook_event_name !== "PreToolUse") return;

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
