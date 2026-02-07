import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import UrlPattern from "url-pattern";

export type IssueTarget = {
  service: "github";
  owner: string;
  repo: string;
  number: number;
};

const issuePattern = new UrlPattern(":owner/:repo/issues/:number");

export function parseIssueUrl(input: string): IssueTarget | null {
  if (!input.startsWith("https://github.com/")) return null;
  const path = input.slice("https://github.com/".length).replace(/\/$/, "");
  const match = issuePattern.match(path);
  if (!match) return null;

  return {
    service: "github",
    owner: match.owner,
    repo: match.repo,
    number: Number.parseInt(match.number, 10),
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
