function parsePath(prUrl: string): string[] {
  const parts = new URL(prUrl).pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Cannot extract owner/repo from URL: ${prUrl}`);
  }
  return parts;
}

export function deriveRepo(prUrl: string): string {
  const parts = parsePath(prUrl);
  return `${parts[0]}/${parts[1]}`;
}

export function derivePaneName(prUrl: string): string {
  const parts = parsePath(prUrl);
  return `review-${parts[0]}-${parts[1]}-${parts.at(-1)}`;
}
