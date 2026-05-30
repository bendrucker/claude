import { join } from "node:path";

// GitLab has no `__typename` to distinguish bots from users. Service accounts
// follow a `*-bot` / `*_bot` convention (CodeRabbit posts under `group_<id>_bot`),
// which is the structural signal. Named bots that break the convention, and any
// humans you want the autonomous loop to act on, are listed additively; see
// loadExtraReviewers.
export function isBotUsername(username: string): boolean {
  return /[_-]bot$/.test(username.toLowerCase());
}

// One username per line in `$CLAUDE_PLUGIN_DATA/reviewers.txt`; blank lines and
// `#` comments are ignored. Absent file or unset env yields an empty set.
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

export function isReviewTarget(username: string, extra: Set<string> = new Set()): boolean {
  return isBotUsername(username) || extra.has(username.toLowerCase());
}
