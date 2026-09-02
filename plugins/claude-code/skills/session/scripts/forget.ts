#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: temporary. Opens the DuckDB index read-write in
// the plugin data dir, which an upstream sandbox defect makes unwritable. Remove this
// when the probe in docs/settings.md succeeds.
import { rm } from "node:fs/promises";
import { cli } from "cleye";
import {
  dirExists,
  ensureSchema,
  forgetHost,
  getDataDir,
  getDb,
  importRoot,
  LOCAL_HOST,
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
  deleted = await forgetHost(db, label);
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
