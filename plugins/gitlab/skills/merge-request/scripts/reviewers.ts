// GitLab has no `__typename` to distinguish bots from users. Service accounts
// follow a `*-bot` / `*_bot` convention, and token service accounts use
// `group_<id>_bot_<hash>` / `project_<id>_bot_<hash>` (CodeRabbit posts under
// a group token account). These are the structural signals. Named bots that
// break the conventions, and any humans you want the autonomous loop to act
// on, are listed additively in the plugin's comma-separated `reviewers`
// option, which the skill passes as `--reviewers`.

const SERVICE_ACCOUNT = /^(?:group|project)_\d+_bot_[0-9a-f]+$/;

export function isBotUsername(username: string): boolean {
  const name = username.toLowerCase();
  return /[_-]bot$/.test(name) || SERVICE_ACCOUNT.test(name);
}

export function parseReviewers(list = ""): Set<string> {
  return new Set(
    list
      .split(",")
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isReviewTarget(username: string, extra = new Set<string>()): boolean {
  return isBotUsername(username) || extra.has(username.toLowerCase());
}
