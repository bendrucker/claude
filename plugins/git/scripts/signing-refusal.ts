#!/usr/bin/env bun

import type {
  PostToolUseFailureHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { PostToolUseFailure } from "./hook-input";

/**
 * `ssh-keygen -Y sign` reports an agent refusal as `Couldn't sign message (signer): ...`
 * and `Signing <file> failed: ...`. The SSH transport's refusal reads
 * `sign_and_send_pubkey: signing failed`, which this deliberately does not match.
 */
const SIGNING_REFUSAL = /(?:Couldn't sign message|Signing .+ failed).*agent refused operation/;
const TAG_SIGNING = "unable to sign the tag";
const GITHUB_REMOTE = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

export function hasSigningRefusal(output: string): boolean {
  return SIGNING_REFUSAL.test(output);
}

export function githubRepoOf(remoteUrl: string): string | null {
  const match = GITHUB_REMOTE.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

async function stdoutOf(command: ReturnType<typeof $>): Promise<string> {
  const result = await command.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : "";
}

/** The branch being committed to, including the one a stopped rebase is rewriting. */
async function currentBranch(cwd: string): Promise<string> {
  const branch = await stdoutOf($`git symbolic-ref --short -q HEAD`.cwd(cwd));
  if (branch !== "") return branch;
  const headName = await stdoutOf(
    $`git rev-parse --path-format=absolute --git-path rebase-merge/head-name`.cwd(cwd),
  );
  if (headName === "") return "";
  const file = Bun.file(headName);
  return (await file.exists()) ? (await file.text()).trim().replace(/^refs\/heads\//, "") : "";
}

async function tagRulesetRequiresSignatures(repo: string): Promise<boolean> {
  const ids = await stdoutOf(
    $`gh api ${`repos/${repo}/rulesets?includes_parents=true`} --jq ${'.[] | select(.target == "tag") | .id'}`,
  );
  const rulesets = await Promise.all(
    ids
      .split("\n")
      .filter(Boolean)
      .map((id) => stdoutOf($`gh api ${`repos/${repo}/rulesets/${id}`} --jq ${".rules[].type"}`)),
  );
  return rulesets.some((types) => types.split("\n").includes("required_signatures"));
}

/** Returns why signing is required for this commit or tag, or null when an unsigned retry is acceptable. */
export async function signingRequirement(cwd: string, tag: boolean): Promise<string | null> {
  if ((await stdoutOf($`git config --bool claude.requireSigning`.cwd(cwd))) === "true")
    return "the repository sets `claude.requireSigning`";

  const repo = githubRepoOf(await stdoutOf($`git remote get-url origin`.cwd(cwd)));
  if (repo == null) return null;

  if (tag)
    return (await tagRulesetRequiresSignatures(repo))
      ? `a ${repo} ruleset requires signed tags`
      : null;

  const branch = await currentBranch(cwd);
  if (branch === "") return null;
  const types = await stdoutOf(
    $`gh api ${`repos/${repo}/rules/branches/${encodeURIComponent(branch)}`} --jq ${".[].type"}`,
  );
  return types.split("\n").includes("required_signatures")
    ? `a ${repo} ruleset requires signed commits on ${branch}`
    : null;
}

export function formatContext(requirement: string | null): string {
  const lead =
    "Git could not sign: the SSH agent refused the signature, likely because it is locked or nobody approved it.";
  if (requirement != null)
    return [
      `${lead} Signing is required here because ${requirement}, so an unsigned commit would be rejected on push.`,
      "Stop and ask the user to unlock or approve the signing agent, then retry once they confirm.",
    ].join("\n");
  return [
    `${lead} This repository doesn't require signatures, so retry unsigned: add \`-c commit.gpgsign=false -c tag.gpgsign=false\` after \`git\`, and drop any explicit \`-S\` or \`git tag -s\`.`,
    "A stopped rebase continues with `git -c commit.gpgsign=false rebase --continue`.",
  ].join("\n");
}

export async function processInput(
  input: PostToolUseFailureHookInput,
  lookup: (cwd: string, tag: boolean) => Promise<string | null> = signingRequirement,
): Promise<SyncHookJSONOutput | null> {
  if (!hasSigningRefusal(input.error)) return null;

  const requirement = await lookup(input.cwd, input.error.includes(TAG_SIGNING));
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: formatContext(requirement),
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseFailureHookInput;
  try {
    input = PostToolUseFailure.parse(JSON.parse(await Bun.stdin.text()));
  } catch {
    // Malformed hook input must not crash the hook. Skip this invocation.
    return;
  }

  const result = await processInput(input);
  if (result) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
