export type Platform = "github" | "gitlab";

function parseUrl(prUrl: string): { hostname: string; parts: string[] } {
  const parsed = new URL(prUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Cannot extract owner/repo from URL: ${prUrl}`);
  }
  return { hostname: parsed.hostname, parts };
}

export function derivePlatform(prUrl: string): Platform {
  const { hostname } = parseUrl(prUrl);
  return hostname.includes("gitlab") ? "gitlab" : "github";
}

export function deriveRepo(prUrl: string): string {
  const { parts } = parseUrl(prUrl);
  return `${parts[0]}/${parts[1]}`;
}

export function derivePaneName(prUrl: string): string {
  const { parts } = parseUrl(prUrl);
  return `review-${parts[0]}-${parts[1]}-${parts.at(-1)}`;
}
