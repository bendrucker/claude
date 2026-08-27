import { join } from "node:path";

// GitLab has no `__typename` to distinguish bots from users. Service accounts
// follow a `*-bot` / `*_bot` convention, and token service accounts use
// `group_<id>_bot_<hash>` / `project_<id>_bot_<hash>` (CodeRabbit posts under
// a group token account). These are the structural signals. Named bots that
// break the conventions, and any humans you want the autonomous loop to act
// on, are listed additively; see loadExtraReviewers.

const SERVICE_ACCOUNT = /^(?:group|project)_\d+_bot_[0-9a-f]+$/;

export function isBotUsername(username: string): boolean {
  const name = username.toLowerCase();
  return /[_-]bot$/.test(name) || SERVICE_ACCOUNT.test(name);
}

// One username per line in `$CLAUDE_PLUGIN_DATA/reviewers.txt`; blank lines and
// `#` comments are ignored. Absent file or unset env yields an empty set.
export async function loadExtraReviewers(): Promise<Set<string>> {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (dataDir == null || dataDir === "") return new Set();
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
