/** Unchanged polls in a row of one merge request, keyed by its URL. */
export type GitlabQuiet = number;

/** The merge requests a session tracks beyond its branch's, and why each is tracked. */
export type GitlabTracked = { url: string; origin: "created" | "pushed" | "manual" }[];

declare module "claude-code" {
  interface PluginState {
    gitlab: { quiet: StateFamily<GitlabQuiet>; tracked: GitlabTracked };
  }
}
