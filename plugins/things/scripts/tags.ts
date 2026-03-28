export function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function mergeTags(...sources: string[][]): string {
  return [...new Set(sources.flat())].join(",");
}
