/** Unchanged polls in a row of one merge request, keyed by its URL. */
export type GitlabQuiet = number;

declare module "claude-code" {
  interface PluginState {
    gitlab: { quiet: StateFamily<GitlabQuiet> };
  }
}
