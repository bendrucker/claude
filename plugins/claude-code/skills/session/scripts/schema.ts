#!/usr/bin/env bun
import * as path from "node:path";
import { z } from "zod";
import { getDataDir, sessionDbPath } from "./db";
import { cliAdapter, runQuery } from "./query";

// The surfaces ad-hoc SQL actually reads, most-used first. Ten covers 81% of measured
// `FROM` demand. Past that the tail costs more tokens than the `DESCRIBE` calls it saves.
export const SURFACES = [
  "content_items",
  "tool_calls",
  "skill_calls",
  "hook_events",
  "messages",
  "message_usage",
  "text_content",
  "attachments",
  "raw",
  "tool_errors",
] as const;

export const FALLBACK_PATH = path.join(import.meta.dirname, "..", "resources", "schema-map.txt");

const COLUMN_QUERY = `
SELECT table_name, list(column_name ORDER BY ordinal_position) AS cols
FROM information_schema.columns
WHERE table_name IN (${SURFACES.map((s) => `'${s}'`).join(", ")})
GROUP BY table_name
`;

export const SurfaceColumns = z.object({ table_name: z.string(), cols: z.array(z.string()) });
type SurfaceColumns = z.infer<typeof SurfaceColumns>;

// Throws on a partial map rather than rendering one. An interrupted rebuild can leave a
// surface absent from the live index, and a map quietly missing `content_items` would
// inject less than the committed fallback holds.
export function renderMap(rows: SurfaceColumns[]): string {
  const byName = new Map(rows.map((row) => [row.table_name, row.cols]));
  const missing = SURFACES.filter((name) => !byName.has(name));
  if (missing.length > 0) throw new Error(`schema map missing ${missing.join(", ")}`);
  return SURFACES.map((name) => `${name}: ${byName.get(name)?.join(" ")}`).join("\n");
}

// Skill load must never fail or stall on the index, so every failure path (no installed
// plugin dir, missing file, a refresh holding the write lock, a `duckdb` that isn't on
// PATH, an index missing a surface) falls through to the committed map. It goes stale
// only when `views.sql` changes, which db.test.ts catches.
async function liveMap(): Promise<string> {
  const adapter = cliAdapter(sessionDbPath(getDataDir()), { timeoutMs: 5_000 });
  return renderMap(await runQuery(adapter, { sql: COLUMN_QUERY }, SurfaceColumns));
}

export async function schemaMap(): Promise<string> {
  try {
    return await liveMap();
  } catch {
    return (await Bun.file(FALLBACK_PATH).text()).trim();
  }
}

if (import.meta.main) {
  console.log(await schemaMap());
}
