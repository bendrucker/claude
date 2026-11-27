#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { Command } from "@commander-js/extra-typings";
import { forgetHost, getDataDir, importRoot, isHostLabel, LOCAL_HOST } from "./db";
import { dirExists } from "./file-catalog";
import { withWriter } from "./index-writer";

export const program = new Command("forget").option(
  "--host <label>",
  "Imported host label to remove (rows and synced files)",
);

const label = (await program.parseAsync()).opts().host;

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
