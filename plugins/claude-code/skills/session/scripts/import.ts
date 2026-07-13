#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import {
  dirExists,
  ensureIndex,
  getDataDir,
  getDb,
  getImportsDir,
  importRoot,
  LOCAL_HOST,
  listImportedHosts,
  type Manifest,
} from "./db";

const argv = cli({
  name: "import",
  flags: {
    host: {
      type: String,
      description: "Label for the imported machine (lands in the host column)",
      required: true as const,
    },
    source: {
      type: String,
      description:
        "rsync source, recorded in the manifest for re-sync (e.g. work:.claude/projects/)",
      default: "",
    },
    egress: {
      type: Boolean,
      description: "Allow this host's rows in output that leaves the machine (default: blocked)",
      default: false,
    },
  },
});

const label = argv.flags.host;

if (!label) {
  console.error("--host is required.");
  process.exit(1);
}

if (label === LOCAL_HOST) {
  console.error(`"${LOCAL_HOST}" is reserved for this machine's own history.`);
  process.exit(1);
}

if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(label)) {
  console.error(`Invalid host label "${label}". Use letters, digits, "-" and "_".`);
  process.exit(1);
}

const root = importRoot(label);
const projectsDir = path.join(root, "projects");
if (!dirExists(projectsDir)) {
  console.error(`No corpus at ${projectsDir}.`);
  console.error("Sync the source machine's ~/.claude/projects/ there first, then re-run:");
  console.error(`  rsync -av --update ${argv.flags.source || "<source>"} ${projectsDir}/`);
  process.exit(1);
}

// Re-running on a registered host is a re-sync: leave the manifest (source, policy,
// imported_at) intact and just re-index the changed files.
const existing = (await listImportedHosts()).find((h) => h.label === label)?.manifest;
const manifestPath = path.join(root, "manifest.json");
if (!existing) {
  await mkdir(getImportsDir(), { recursive: true, mode: 0o700 });
  const manifest: Manifest = {
    host: label,
    source: argv.flags.source,
    imported_at: new Date().toISOString(),
    policy: { block_egress: !argv.flags.egress },
  };
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // Lock down the import tree: 0700 dirs, 0600 manifest (no Bun chmod API).
  await $`chmod 700 ${getImportsDir()} ${root}`.quiet();
  await $`chmod 600 ${manifestPath}`.quiet();
}

const dataDir = getDataDir();
await mkdir(dataDir, { recursive: true });

const db = await getDb(dataDir);
try {
  await ensureIndex(db);
} finally {
  db.close();
}

const blockEgress = existing ? (existing.policy?.block_egress ?? true) : !argv.flags.egress;
console.log(`${existing ? "Re-indexed" : "Imported"} host "${label}" from ${projectsDir}`);
console.log(`  egress: ${blockEgress ? "blocked" : "allowed"}`);
