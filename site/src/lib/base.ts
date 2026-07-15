/** Joins a site-relative route (e.g. `/plugins/git/`) with the configured `base` path. */
export function withBase(route: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${route}`;
}
