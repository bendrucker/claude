export function parseExtraTags(env: string | undefined): string[] {
  if (!env) return [];
  return env
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function mergeTags(existing: string | undefined, extraTags: string[] = []): string {
  const base = ["Claude", ...extraTags];
  const existingTags = existing ? existing.split(",").map((t) => t.trim()) : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of [...base, ...existingTags]) {
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result.join(",");
}
