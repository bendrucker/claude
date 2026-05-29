export interface Author {
  login: string;
  __typename?: string;
}

// Login allowlist for AI review bots that GraphQL surfaces as `User` rather than
// `Bot` (GitHub Apps and `[bot]` accounts). Matching is substring-based against
// the normalized login, so `coderabbitai[bot]`, `github-copilot[bot]`, and
// `greptile-apps[bot]` all match their seed. Add a new reviewer by appending its
// stable login fragment here; unlisted bots are still caught by the
// `__typename === "Bot"` rule in `isBot`.
export const GITHUB_BOT_LOGINS = [
  "coderabbitai",
  "copilot", // copilot-pull-request-reviewer, github-copilot[bot]
  "greptile", // greptile-apps[bot], greptileai
];

function normalizeLogin(login: string): string {
  return login.toLowerCase().replace(/\[bot\]$/, "");
}

export function isBotLogin(login: string): boolean {
  const normalized = normalizeLogin(login);
  return GITHUB_BOT_LOGINS.some((seed) => normalized.includes(seed));
}

export function isBot(author: Author | null | undefined): boolean {
  if (!author) return false;
  if (author.__typename === "Bot") return true;
  return isBotLogin(author.login);
}
