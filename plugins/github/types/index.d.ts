/** Unchanged polls in a row of one pull request, keyed by its URL. */
export type GithubQuiet = number;

declare module "claude-code" {
  interface PluginState {
    github: { quiet: StateFamily<GithubQuiet> };
  }
}
