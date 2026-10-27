#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: writes the host's copy under
// ~/.claude/session-imports, which the sandbox denies.
//
// Refreshes an S3-backed host's local copy to a trailing window of sessions.
// The bucket keeps every session, and the Mac keeps only the ones uploaded to
// within `--days`, the way `cleanupPeriodDays` bounds `local`. The next
// refresh imports what arrived and reaps the rows of what left.
import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";
import { getImportsDir, listImportedHosts } from "./db";

export interface S3Object {
  key: string;
  size: number;
  lastModified: number;
}

export interface Plan {
  /** Sessions with an object missing or smaller locally. */
  fetch: string[];
  /** Local session directories outside the window or gone from the bucket. */
  drop: string[];
}

// Grouped by session, the first path segment under the prefix, so a session
// is kept or dropped whole by its newest upload.
export function plan(
  objects: S3Object[],
  local: Map<string, number>,
  localSessions: string[],
  cutoff: number,
): Plan {
  const sessions = new Map<string, S3Object[]>();
  for (const object of objects) {
    const session = object.key.split("/")[0] ?? "";
    sessions.set(session, [...(sessions.get(session) ?? []), object]);
  }
  const kept = new Set(
    [...sessions].filter(([, objs]) => Math.max(...objs.map((o) => o.lastModified)) >= cutoff),
  );
  const keptNames = new Set([...kept].map(([session]) => session));
  return {
    fetch: [...kept]
      .filter(([, objs]) => objs.some((o) => (local.get(o.key) ?? -1) < o.size))
      .map(([session]) => session),
    drop: localSessions.filter((session) => !keptNames.has(session)),
  };
}

const Listing = z.object({
  Contents: z
    .array(z.object({ Key: z.string(), Size: z.number(), LastModified: z.string() }))
    .default([]),
});

async function list(bucket: string, prefix: string): Promise<S3Object[]> {
  const out =
    await $`aws s3api list-objects-v2 --bucket ${bucket} --prefix ${prefix} --output json`.text();
  return Listing.parse(out.trim() === "" ? {} : JSON.parse(out)).Contents.map((o) => ({
    key: o.Key.slice(prefix.length),
    size: o.Size,
    lastModified: Date.parse(o.LastModified),
  }));
}

function localFiles(root: string): Map<string, number> {
  const files = new Map<string, number>();
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files.set(full.slice(root.length + 1), Bun.file(full).size);
  }
  return files;
}

if (import.meta.main) {
  const argv = cli({
    name: "pull",
    flags: {
      host: {
        type: String,
        description: "Imported host with an s3:// source",
        required: true as const,
      },
      days: {
        type: Number,
        description: "Keep sessions uploaded to within this many days (matches cleanupPeriodDays)",
        default: 90,
      },
    },
  });

  const hosts = await listImportedHosts();
  const host = hosts.find((h) => h.label === argv.flags.host);
  const match = /^s3:\/\/([^/]+)\/(.*?)\/?$/.exec(host?.manifest.source ?? "");
  if (host === undefined || match === null) {
    const found =
      hosts.length === 0
        ? "none"
        : hosts.map((h) => `${h.label} (${h.manifest.source})`).join(", ");
    console.error(
      `No imported host "${argv.flags.host}" with an s3:// source in ${getImportsDir()}; found ${found}. Run import.ts first.`,
    );
    process.exit(1);
  }
  const [, bucket = "", base = ""] = match;
  const prefix = base === "" ? "" : `${base}/`;
  const root = join(host.root, "projects");

  const objects = await list(bucket, prefix);
  const localSessions = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const { fetch, drop } = plan(
    objects,
    localFiles(root),
    localSessions,
    Date.now() - argv.flags.days * 86_400_000,
  );

  await Promise.all(drop.map((session) => rm(join(root, session), { recursive: true })));
  for (const session of fetch) {
    // oxlint-disable-next-line no-await-in-loop -- one aws process at a time
    await $`aws s3 sync --only-show-errors s3://${bucket}/${prefix}${session}/ ${join(root, session)}/`;
  }
  console.error(`${argv.flags.host}: fetched ${fetch.length} session(s), dropped ${drop.length}`);
}
