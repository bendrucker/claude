import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FetchedContext } from "./sources";

const srcRoot = join(process.env.HOME ?? "", "src");

function gitlabRepoPath(project: string): string {
  const segments = project.split("/");
  const org = segments[segments.length - 2];
  const repo = segments[segments.length - 1];
  if (!org || !repo) {
    throw new Error(`Cannot extract org/repo from GitLab project: ${project}`);
  }
  return join(srcRoot, org, repo);
}

export async function resolveRepo(context: FetchedContext): Promise<string> {
  switch (context.type) {
    case "github-pr":
    case "github-issue": {
      const repoPath = join(srcRoot, context.source.owner, context.source.repo);
      if (!existsSync(repoPath)) {
        throw new Error(`Repository not found: ${repoPath}`);
      }
      return repoPath;
    }

    case "gitlab-mr":
    case "gitlab-issue": {
      const repoPath = gitlabRepoPath(context.source.project);
      if (!existsSync(repoPath)) {
        throw new Error(`Repository not found: ${repoPath}`);
      }
      return repoPath;
    }

    case "linear": {
      const repoPath = resolveFromAttachments(context.attachments);
      if (repoPath) return repoPath;
      return pickRepo();
    }

    case "things": {
      return pickRepo();
    }
  }
}

function resolveFromAttachments(attachments: Array<{ url?: string }>): string | undefined {
  for (const attachment of attachments) {
    const url = attachment.url;
    if (!url) continue;

    const ghMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      const repoPath = join(srcRoot, ghMatch[1]!, ghMatch[2]!);
      if (existsSync(repoPath)) return repoPath;
    }

    const glMatch = url.match(/gitlab\.com\/(.+)\/-\//);
    if (glMatch) {
      try {
        const repoPath = gitlabRepoPath(glMatch[1]!);
        if (existsSync(repoPath)) return repoPath;
      } catch {
        // project path couldn't be parsed, skip
      }
    }
  }

  return undefined;
}

async function pickRepo(): Promise<string> {
  const result = Bun.spawnSync(
    ["bash", "-c", `find ${srcRoot} -mindepth 2 -maxdepth 2 -type d | fzf --prompt "Repository: "`],
    { stdout: "pipe", stderr: "inherit", stdin: "inherit" },
  );

  if (result.exitCode !== 0) {
    throw new Error("No repository selected");
  }

  return result.stdout.toString().trim();
}
