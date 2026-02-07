import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type IssueTarget = {
  service: "github";
  owner: string;
  repo: string;
  number: number;
};

const githubIssuePattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

export function parseIssueUrl(input: string): IssueTarget | null {
  const match = input.match(githubIssuePattern);
  if (!match?.[1] || !match[2] || !match[3]) return null;

  return {
    service: "github",
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

function targetPath(sessionId: string): string {
  return join("/tmp/claude", sessionId, "implement-issue-target.json");
}

export function readTarget(sessionId: string): IssueTarget | null {
  try {
    const content = readFileSync(targetPath(sessionId), "utf-8");
    return JSON.parse(content) as IssueTarget;
  } catch {
    return null;
  }
}

export function writeTarget(sessionId: string, target: IssueTarget): void {
  const path = targetPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(target));
}
