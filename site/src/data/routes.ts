const GITHUB_REPO = "bendrucker/claude";
const GITHUB_REF = "main";

export function pluginRoute(plugin: string): string {
  return `/plugins/${plugin}/`;
}

/** Absolute GitHub blob URL for a repo-relative path. */
export function githubBlobUrl(repoPath: string): string {
  return `https://github.com/${GITHUB_REPO}/blob/${GITHUB_REF}/${repoPath}`;
}

const PLUGIN_README = /^plugins\/([^/]+)\/README\.md$/;
const PLUGIN_DIR = /^plugins\/([^/]+)\/?$/;

/**
 * Maps a repo-relative path to the one kind of page this site builds: a
 * plugin's own page, which renders its README. Every other path (skills,
 * agents, references, commands, scripts, config) returns `undefined`, and
 * callers fall back to {@link githubBlobUrl}. Rewriting a README's relative
 * links depends on that fallback, so `undefined` is an expected result for
 * most inputs.
 */
export function repoPathToRoute(repoPath: string): string | undefined {
  const plugin = (PLUGIN_README.exec(repoPath) ?? PLUGIN_DIR.exec(repoPath))?.[1];
  return plugin ? pluginRoute(plugin) : undefined;
}
