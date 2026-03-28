export function parseExtraTags(env: string | undefined): string[] {
  if (!env) return [];
  return env
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function mergeTags(existing: string | undefined, extraTags: string[] = []): string {
  const existingTags = existing ? existing.split(",").map((t) => t.trim()) : [];
  return [...new Set(["Claude", ...extraTags, ...existingTags])].join(",");
}
