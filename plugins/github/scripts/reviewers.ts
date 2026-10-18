import { z } from "zod";

export const Author = z.looseObject({
  login: z.string(),
  __typename: z.string().optional(),
});
export type Author = z.infer<typeof Author>;

// GitHub classifies bot accounts natively: GraphQL reports `__typename: "Bot"`
// for GitHub Apps and bot users (Copilot, CodeRabbit, Greptile, and the rest).
// Trust it instead of maintaining a login allowlist.
export function isBot(author: Author | null | undefined): boolean {
  return author?.__typename === "Bot";
}

// Logins to triage beyond what the API types as a bot: a reviewer the API ever
// surfaces as a User, or a human you want the autonomous loop to act on. The
// skill passes the plugin's comma-separated `reviewers` option.
export function parseReviewers(list = ""): Set<string> {
  return new Set(
    list
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isReviewTarget(
  author: Author | null | undefined,
  extra = new Set<string>(),
): boolean {
  if (!author) return false;
  if (isBot(author)) return true;
  return extra.has(author.login.toLowerCase());
}
