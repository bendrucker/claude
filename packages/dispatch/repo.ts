import { existsSync } from "node:fs";
import { join } from "node:path";

export const srcRoot = join(process.env.HOME ?? "", "src");

export function resolveGitHubRepo(owner: string, repo: string): string {
  const repoPath = join(srcRoot, owner, repo);
  if (!existsSync(repoPath)) {
    throw new Error(`Repository not found: ${repoPath}`);
  }
  return repoPath;
}

export function resolveGitLabRepo(project: string): string {
  const segments = project.split("/");
  const org = segments[segments.length - 2];
  const repo = segments[segments.length - 1];
  if (!org || !repo) {
    throw new Error(`Cannot extract org/repo from GitLab project: ${project}`);
  }
  const repoPath = join(srcRoot, org, repo);
  if (!existsSync(repoPath)) {
    throw new Error(`Repository not found: ${repoPath}`);
  }
  return repoPath;
}

export async function pickRepo(): Promise<string> {
  const result = Bun.spawnSync(
    ["bash", "-c", `find ${srcRoot} -mindepth 2 -maxdepth 2 -type d | fzf --prompt "Repository: "`],
    { stdout: "pipe", stderr: "inherit", stdin: "inherit" },
  );

  if (result.exitCode !== 0) {
    throw new Error("No repository selected");
  }

  return result.stdout.toString().trim();
}
