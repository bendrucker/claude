#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: temporary. Opens the DuckDB index read-write in
// the plugin data dir, which an upstream sandbox defect makes unwritable. Remove this
// when the probe in docs/settings.md succeeds.
import { rm } from "node:fs/promises";
import { cli } from "cleye";
import { z } from "zod";
import {
  dirExists,
  ensureSchema,
  getDataDir,
  getDb,
  importRoot,
  invalidateDerived,
  LOCAL_HOST,
  rebuildViews,
} from "./db";

const argv = cli({
  name: "forget",
  flags: {
    host: {
      type: String,
      description: "Imported host label to remove (rows and synced files)",
      required: true as const,
    },
  },
});

const label = argv.flags.host;

if (label == null || label === "") {
  console.error("--host is required.");
  process.exit(1);
}

if (label === LOCAL_HOST) {
  console.error(`"${LOCAL_HOST}" is this machine's own history and cannot be forgotten.`);
  process.exit(1);
}

const db = await getDb(getDataDir());
let deleted = 0;
try {
  await ensureSchema(db);
  const [row] = await db.query(
    "SELECT COUNT(*) AS n FROM raw WHERE host = $host",
    z.object({ n: z.bigint() }),
    {
      host: label,
    },
  );
  deleted = Number(row?.n ?? 0n);
  // One transaction: a partial forget that kept indexed_files rows would make a
  // later re-import of the same label skip every unchanged file while raw stays
  // empty. The views rebuild drops the host from content_items. CHECKPOINT cannot
  // run inside a transaction.
  //
  // Marking the derived tables stale first is what keeps a forget durable. A crash
  // between the commit and the rebuild would otherwise leave the host's rows in
  // content_items with nothing left to ask for their removal: its files are gone, so no
  // later refresh sees a change.
  await invalidateDerived(db);
  await db.run("BEGIN");
  await db.run("DELETE FROM raw WHERE host = $host", { host: label });
  await db.run("DELETE FROM indexed_files WHERE host = $host", { host: label });
  await db.run("DELETE FROM meta WHERE host = $host", { host: label });
  await db.run("COMMIT");
  await rebuildViews(db);
  await db.run("CHECKPOINT");
} finally {
  db.close();
}

const root = importRoot(label);
const removedFiles = dirExists(root);
if (removedFiles) {
  await rm(root, { recursive: true, force: true });
}

console.log(
  `Forgot host "${label}": ${deleted} rows removed${removedFiles ? `, ${root} deleted` : ""}`,
);
