#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: temporary. Opens the DuckDB index read-write in
// the plugin data dir, which an upstream sandbox defect makes unwritable. Remove this
// when the probe in .claude/rules/settings.md succeeds.
import * as path from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { getDataDir, getDb, LOCAL_HOST, listImportedHosts, sessionDbPath } from "./db";

cli({ name: "hosts", flags: {} });

const dataDir = getDataDir();

async function lastImports(): Promise<Record<string, string>> {
  if (!(await Bun.file(sessionDbPath(dataDir)).exists())) return {};
  const db = await getDb(dataDir);
  try {
    const rows = await db.query<{ host: string; last_import: string | null }>(
      "SELECT host, strftime(last_import, '%Y-%m-%d %H:%M') AS last_import FROM meta",
    );
    return Object.fromEntries(rows.map((r) => [r.host, r.last_import ?? "-"]));
  } catch {
    return {};
  } finally {
    db.close();
  }
}

const imported = await listImportedHosts();
const watermarks = await lastImports();

const rows: string[][] = [["HOST", "IMPORTED", "EGRESS", "LAST IMPORT", "SOURCE"]];
rows.push([LOCAL_HOST, "-", "allowed", watermarks[LOCAL_HOST] ?? "-", "(this machine)"]);
for (const { label, manifest } of imported) {
  rows.push([
    label,
    manifest.imported_at,
    (manifest.policy?.block_egress ?? true) ? "blocked" : "allowed",
    watermarks[label] ?? "-",
    manifest.source || "-",
  ]);
}

console.log(table(rows));

if (imported.length > 0) {
  console.log("Re-sync (copy, paste, run, then re-run import.ts):\n");
  for (const { label, root, manifest } of imported) {
    const source = manifest.source || "<source>";
    console.log(`  ${label}:`);
    console.log(`    rsync -av --update ${source} ${path.join(root, "projects")}/`);
  }
}
