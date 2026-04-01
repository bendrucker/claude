import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type GitHubTarget = { service: "github"; owner: string; repo: string; number: number };
export type LinearTarget = { service: "linear"; identifier: string };
export type GitLabTarget = { service: "gitlab"; project: string; number: number };
export type IssueTarget = GitHubTarget | LinearTarget | GitLabTarget;

const githubIssuePattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;
const linearIssuePattern = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/;
const gitlabIssuePattern = /^https:\/\/gitlab\.com\/(.+)\/-\/issues\/(\d+)\/?$/;

export function parseIssueUrl(input: string): IssueTarget | null {
  const github = input.match(githubIssuePattern);
  if (github?.[1] && github[2] && github[3]) {
    return {
      service: "github",
      owner: github[1],
      repo: github[2],
      number: Number.parseInt(github[3], 10),
    };
  }

  const linear = input.match(linearIssuePattern);
  if (linear?.[1]) {
    return {
      service: "linear",
      identifier: linear[1],
    };
  }

  const gitlab = input.match(gitlabIssuePattern);
  if (gitlab?.[1] && gitlab[2]) {
    return {
      service: "gitlab",
      project: gitlab[1],
      number: Number.parseInt(gitlab[2], 10),
    };
  }

  return null;
}

function targetPath(sessionId: string): string {
  return join("/tmp/claude", sessionId, "issue-target.json");
}

export async function readTarget(sessionId: string): Promise<IssueTarget | null> {
  const file = Bun.file(targetPath(sessionId));
  if (!(await file.exists())) return null;
  return file.json();
}

export async function writeTarget(sessionId: string, target: IssueTarget): Promise<void> {
  const path = targetPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(target));
}
