/** Unchanged polls in a row of one pull request, keyed by its URL. */
export type GithubQuiet = number;

/** The pull requests a session watches beyond its branch's, and why. */
export type GithubTracked = { url: string; origin: "created" | "stacked" | "manual" }[];

declare module "claude-code" {
  interface PluginState {
    github: { quiet: StateFamily<GithubQuiet>; tracked: GithubTracked };
  }
}
