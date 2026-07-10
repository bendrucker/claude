#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { cli } from "cleye";
import { dirExists, ensureSchema, getDataDir, getDb, importRoot, LOCAL_HOST } from "./db";

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

if (!label) {
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
  const [row] = await db.query<{ n: bigint }>("SELECT COUNT(*) AS n FROM raw WHERE host = $host", {
    host: label,
  });
  deleted = Number(row?.n ?? 0n);
  // One transaction: a partial forget that kept indexed_files rows would make a
  // later re-import of the same label skip every unchanged file while raw stays
  // empty. CHECKPOINT cannot run inside a transaction.
  await db.run("BEGIN");
  await db.run("DELETE FROM raw WHERE host = $host", { host: label });
  await db.run("DELETE FROM content_items WHERE host = $host", { host: label });
  await db.run("DELETE FROM indexed_files WHERE host = $host", { host: label });
  await db.run("DELETE FROM meta WHERE host = $host", { host: label });
  await db.run("COMMIT");
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
