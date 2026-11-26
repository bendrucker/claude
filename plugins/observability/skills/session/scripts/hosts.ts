#!/usr/bin/env bun
import { join } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";
import { getDataDir, LOCAL_HOST, listImportedHosts } from "./db";
import { errorClass } from "./events";
import { withReader } from "./index-writer";
import { list, s3Location, type Staleness, uploadStaleness } from "./pull";

const argv = cli({
  name: "hosts",
  flags: {
    staleDays: {
      type: Number,
      description:
        "Flag an s3:// host whose newest uploaded object is older than this many days, and exit 1",
      default: 3,
    },
  },
});

const dataDir = getDataDir();

async function lastImports(): Promise<Record<string, string>> {
  const watermarks = await withReader(dataDir, async (db) => {
    try {
      const rows = await db.query(
        "SELECT host, strftime(last_import, '%Y-%m-%d %H:%M') AS last_import FROM meta",
        z.object({ host: z.string(), last_import: z.string().nullable() }),
      );
      return Object.fromEntries(rows.map((r) => [r.host, r.last_import ?? "-"]));
    } catch (error) {
      // An index from another version may lack the `meta` table or a column of it.
      if (!/^(Catalog|Binder) Error$/.test(errorClass(error))) throw error;
      return {};
    }
  });
  return watermarks ?? {};
}

const minute = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

// An s3:// host's newest upload, read from the bucket, since the index only
// knows what was last pulled. A listing that fails is an Error, not fresh.
async function uploads(source: string): Promise<Staleness | Error | undefined> {
  const location = s3Location(source);
  if (location === undefined) return undefined;
  try {
    const objects = await list(location.bucket, location.prefix);
    return uploadStaleness(objects, Date.now(), argv.flags.staleDays);
  } catch (error) {
    return new Error(errorClass(error));
  }
}

function newestColumn(upload: Staleness | Error | undefined): string {
  if (upload === undefined) return "-";
  if (upload instanceof Error) return "error";
  const newest = upload.newest === undefined ? "none" : minute(upload.newest);
  return upload.stale ? `${newest} (stale)` : newest;
}

const imported = await listImportedHosts();
const [watermarks, newest] = await Promise.all([
  lastImports(),
  Promise.all(imported.map(({ manifest }) => uploads(manifest.source))),
]);

const rows: string[][] = [["HOST", "IMPORTED", "EGRESS", "LAST IMPORT", "NEWEST UPLOAD", "SOURCE"]];
rows.push([LOCAL_HOST, "-", "allowed", watermarks[LOCAL_HOST] ?? "-", "-", "(this machine)"]);
for (const [i, { label, manifest }] of imported.entries()) {
  rows.push([
    label,
    manifest.imported_at,
    (manifest.policy.block_egress ?? true) ? "blocked" : "allowed",
    watermarks[label] ?? "-",
    newestColumn(newest[i]),
    manifest.source !== "" ? manifest.source : "-",
  ]);
}

console.log(table(rows));

// One line per host a scheduled check should surface, keyed on `stale:` and the
// exit status. Printed after the table so a caller tailing stderr sees them last.
const warnings = imported.flatMap(({ label }, i) => {
  const upload = newest[i];
  if (upload instanceof Error) return [`stale: ${label} not checked: ${upload.message}`];
  if (upload?.stale !== true) return [];
  const last =
    upload.newest === undefined ? "no uploads" : `newest upload ${minute(upload.newest)} UTC`;
  return [`stale: ${label} ${last}, threshold ${argv.flags.staleDays} day(s)`];
});
for (const warning of warnings) console.error(warning);
if (warnings.length > 0) process.exitCode = 1;

if (imported.length > 0) {
  console.log("Re-sync (copy, paste, run, then re-run import.ts):\n");
  for (const { label, root, manifest } of imported) {
    const source = manifest.source !== "" ? manifest.source : "<source>";
    console.log(`  ${label}:`);
    const dest = `${join(root, "projects")}/`;
    console.log(
      source.startsWith("s3://")
        ? `    bun ${join(import.meta.dir, "pull.ts")} --host ${label}`
        : `    rsync -av --update ${source} ${dest}`,
    );
  }
}
