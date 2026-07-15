import type { APIRoute } from "astro";
import { loadCatalog } from "../data/catalog";
import { REPO_ROOT } from "../lib/repo-root";

export const prerender = true;

/** Published artifact for other sites: the same `loadCatalog()` the pages render from, so it cannot drift. */
export const GET: APIRoute = async () => {
  const catalog = await loadCatalog({ root: REPO_ROOT });
  return new Response(JSON.stringify({ schemaVersion: 1, ...catalog }), {
    headers: { "Content-Type": "application/json" },
  });
};
