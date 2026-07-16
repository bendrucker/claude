// Mirrors the constants behind `githubBlobUrl` in `site/src/data/routes.ts`.
// That module only exports a blob-URL builder; a directory listing needs a
// `tree` URL instead, so it is rebuilt here rather than editing the data layer.
const GITHUB_REPO = "bendrucker/claude";
const GITHUB_REF = "main";

/** GitHub tree (directory listing) URL for a repo-relative path. */
function githubTreeUrl(repoPath: string): string {
  return `https://github.com/${GITHUB_REPO}/tree/${GITHUB_REF}/${repoPath}`;
}

/** GitHub URL for a plugin's own source, local or remote. */
export function pluginSourceUrl(source: string | { source: string; repo?: string }): string {
  if (typeof source === "object" && source.repo) return `https://github.com/${source.repo}`;
  return githubTreeUrl(typeof source === "string" ? source.replace(/^\.\//, "") : "");
}
