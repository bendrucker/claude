#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: deletes the host's copy under
// ~/.claude/session-imports, which the sandbox denies.
import { rm } from "node:fs/promises";
import { cli } from "cleye";
import { forgetHost, getDataDir, importRoot, isHostLabel, LOCAL_HOST } from "./db";
import { dirExists } from "./file-catalog";
import { withWriter } from "./index-writer";

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

if (!isHostLabel(label)) {
  console.error(`Invalid host label "${label}". Use letters, digits, "-" and "_".`);
  process.exit(1);
}

const deleted = await withWriter(getDataDir(), (db) => forgetHost(db, label));

const root = importRoot(label);
const removedFiles = dirExists(root);
if (removedFiles) {
  await rm(root, { recursive: true, force: true });
}

console.log(
  `Forgot host "${label}": ${deleted} rows removed${removedFiles ? `, ${root} deleted` : ""}`,
);
