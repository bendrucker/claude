import { join } from "node:path";

export interface Author {
  login: string;
  __typename?: string;
}

// GitHub classifies bot accounts natively: GraphQL reports `__typename: "Bot"`
// for GitHub Apps and bot users (Copilot, CodeRabbit, Greptile, and the rest).
// Trust it instead of maintaining a login allowlist.
export function isBot(author: Author | null | undefined): boolean {
  return author?.__typename === "Bot";
}

// Logins to triage beyond what the API types as a bot: a reviewer the API ever
// surfaces as a User, or a human you want the autonomous loop to act on. One
// login per line in `$CLAUDE_PLUGIN_DATA/reviewers.txt`; blank lines and `#`
// comments are ignored. Absent file or unset env yields an empty set.
export async function loadExtraReviewers(): Promise<Set<string>> {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) return new Set();
  const file = Bun.file(join(dataDir, "reviewers.txt"));
  if (!(await file.exists())) return new Set();
  return parseReviewers(await file.text());
}

export function parseReviewers(contents: string): Set<string> {
  return new Set(
    contents
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isReviewTarget(
  author: Author | null | undefined,
  extra: Set<string> = new Set(),
): boolean {
  if (!author) return false;
  if (isBot(author)) return true;
  return extra.has(author.login.toLowerCase());
}
