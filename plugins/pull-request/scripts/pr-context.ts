#!/usr/bin/env bun
// Fetch PR/MR context for update skill
// Args: <branch> <graphql-query-file>
// Detects provider and uses gh (GitHub) or glab (GitLab)

import { readFile } from "node:fs/promises";
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
  lastEditedAt: string | null;
  commits: Commit[];
}

async function fetchGitHubContext(queryFile: string, cwd?: string): Promise<PRContext> {
  const shell = cwd ? $.cwd(cwd) : $;

  const [owner, repo, number, query] = await Promise.all([
    shell`gh repo view --json owner --jq '.owner.login'`.text(),
    shell`gh repo view --json name --jq '.name'`.text(),
    shell`gh pr view --json number --jq '.number'`.text(),
    readFile(queryFile, "utf-8"),
  ]);

  const result =
    await shell`gh api graphql -F owner=${owner.trim()} -F repo=${repo.trim()} -F number=${number.trim()} -f query=${query}`.text();

  const data = JSON.parse(result);
  const pr = data?.data?.repository?.pullRequest;
  if (!pr) {
    const errors = data?.errors;
    if (errors?.length) {
      throw new Error(`GraphQL error: ${errors[0].message}`);
    }
    throw new Error("Unexpected GraphQL response: missing pullRequest data");
  }

  return {
    title: pr.title,
    body: pr.body,
    lastEditedAt: pr.lastEditedAt,
    commits: (pr.commits?.nodes ?? []).map((n: { commit: Commit }) => n.commit),
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
    lastEditedAt: mr.updated_at,
    commits: [],
  };
}

if (import.meta.main) {
  const [branch = "", queryFile] = process.argv.slice(2);
  const provider = detectProvider();
  const cwd = (await resolveWorktree(branch)) || undefined;

  try {
    let context: PRContext;

    if (provider === "github") {
      if (!queryFile) {
        console.error("Usage: pr-context.ts <branch> <graphql-query-file>");
        process.exit(1);
      }
      context = await fetchGitHubContext(queryFile, cwd);
    } else if (provider === "gitlab") {
      context = await fetchGitLabContext(cwd);
    } else {
      console.error("Unknown provider");
      process.exit(1);
    }

    console.log(JSON.stringify(context, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
