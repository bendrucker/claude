#!/usr/bin/env bun
// Fetch PR/MR context for update skill
// Args: <branch>
// Detects provider and uses gh (GitHub) or glab (GitLab)

import { $ } from "bun";
import { detectProvider } from "./detect-provider";
import { resolveWorktree } from "./worktree/resolve";

interface Commit {
  oid: string;
  message: string;
  committedDate: string;
}

interface PRContext {
  title: string;
  body: string;
  updatedAt: string;
  commits: Commit[];
}

interface GitHubCommit {
  oid: string;
  messageHeadline: string;
  committedDate: string;
}

async function fetchGitHubContext(cwd?: string): Promise<PRContext> {
  const shell = cwd ? $.cwd(cwd) : $;

  const result = await shell`gh pr view --json title,body,updatedAt,commits`.text();

  const pr = JSON.parse(result);

  return {
    title: pr.title,
    body: pr.body,
    updatedAt: pr.updatedAt,
    commits: (pr.commits ?? []).map((c: GitHubCommit) => ({
      oid: c.oid,
      message: c.messageHeadline,
      committedDate: c.committedDate,
    })),
  };
}

async function fetchGitLabContext(cwd?: string): Promise<PRContext> {
  const shell = cwd ? $.cwd(cwd) : $;

  const currentBranch = (await shell`git branch --show-current`.text()).trim();
  const result =
    await shell`glab api projects/:id/merge_requests?source_branch=${currentBranch}&state=opened`.text();

  const mrs = JSON.parse(result);
  if (!mrs.length) {
    throw new Error("No MR found for current branch");
  }

  const mr = mrs[0];
  return {
    title: mr.title,
    body: mr.description || "",
    updatedAt: mr.updated_at,
    commits: [],
  };
}

if (import.meta.main) {
  const [branch = ""] = process.argv.slice(2);
  const provider = detectProvider();
  const cwd = (await resolveWorktree(branch)) || undefined;

  try {
    let context: PRContext;

    if (provider === "github") {
      context = await fetchGitHubContext(cwd);
    } else if (provider === "gitlab") {
      context = await fetchGitLabContext(cwd);
    } else {
      console.error("Unknown provider");
      process.exit(1);
    }

    console.log(JSON.stringify(context, null, 2));
  } catch (error) {
    console.log("No PR found for current branch");
    process.exit(0);
  }
}
