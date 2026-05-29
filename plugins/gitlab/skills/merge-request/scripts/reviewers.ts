// GitLab has no `__typename` to distinguish bots from users, so AI reviewers are
// identified by username alone. CodeRabbit posts under a project bot account
// (`group_<id>_bot`); other reviewers use `*-bot` / `*_bot` service accounts.
// Add a new reviewer by appending a stable username fragment here.
export const GITLAB_BOT_USERNAMES = ["coderabbit", "greptile", "copilot"];

export function isBotUsername(username: string): boolean {
  const normalized = username.toLowerCase();
  // group_<id>_bot, my-reviewer-bot, service_bot, etc.
  if (/[_-]bot$/.test(normalized)) return true;
  return GITLAB_BOT_USERNAMES.some((seed) => normalized.includes(seed));
}
