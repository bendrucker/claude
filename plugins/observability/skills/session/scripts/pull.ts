#!/usr/bin/env bun
// Refreshes an S3-backed host's local copy to a trailing window of sessions.
// The bucket keeps every session, and the Mac keeps only the ones uploaded to
// within `--days`, the way `cleanupPeriodDays` bounds `local`. The next
// refresh imports what arrived and reaps the rows of what left. A session's
// `mod-events/` objects land in the host's own mod-events directory, laid out
// as `local`'s is, rather than among its transcripts.
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

export async function list(bucket: string, prefix: string): Promise<S3Object[]> {
  const out =
    await $`aws s3api list-objects-v2 --bucket ${bucket} --prefix ${prefix} --output json`.text();
  return Listing.parse(out.trim() === "" ? {} : JSON.parse(out)).Contents.map((o) => ({
    key: o.Key.slice(prefix.length),
    size: o.Size,
    lastModified: Date.parse(o.LastModified),
  }));
}

// `s3://bucket/prefix` → the bucket and the listing prefix, with its trailing slash.
export function s3Location(source: string): { bucket: string; prefix: string } | undefined {
  const match = /^s3:\/\/([^/]+)\/(.*?)\/?$/.exec(source);
  if (match === null) return undefined;
  const [, bucket = "", base = ""] = match;
  return { bucket, prefix: base === "" ? "" : `${base}/` };
}

export interface Staleness {
  /** When the newest object was uploaded, or undefined for an empty prefix. */
  newest: number | undefined;
  stale: boolean;
}

// The uploader overwrites each object as its session grows, so the newest
// LastModified is the last upload that landed. An empty prefix has never
// received one.
export function uploadStaleness(objects: S3Object[], now: number, days: number): Staleness {
  const newest = objects.length === 0 ? undefined : Math.max(...objects.map((o) => o.lastModified));
  return { newest, stale: newest === undefined || now - newest > days * 86_400_000 };
}

const MOD_EVENTS = "mod-events";

// Local sizes keyed as the bucket keys them, so `mod-events/<session>/<file>`
// reads back as `<session>/mod-events/<file>`.
export function localFiles(root: string, events: string): Map<string, number> {
  return new Map([
    ...filesUnder(root),
    ...filesUnder(events).map(([rel, size]): [string, number] => [
      rel.replace("/", `/${MOD_EVENTS}/`),
      size,
    ]),
  ]);
}

// A missing directory holds nothing yet. Any other failure propagates, since a short
// listing would refetch what is already local.
function filesUnder(dir: string): [string, number][] {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(entry.parentPath, entry.name);
        return [full.slice(dir.length + 1), Bun.file(full).size];
      });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
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
  const location = s3Location(host?.manifest.source ?? "");
  if (host === undefined || location === undefined) {
    const found =
      hosts.length === 0
        ? "none"
        : hosts.map((h) => `${h.label} (${h.manifest.source})`).join(", ");
    console.error(
      `No imported host "${argv.flags.host}" with an s3:// source in ${getImportsDir()}; found ${found}. Run import.ts first.`,
    );
    process.exit(1);
  }
  const { bucket, prefix } = location;
  const root = join(host.root, "projects");
  const events = join(host.root, MOD_EVENTS);

  const objects = await list(bucket, prefix);
  const localSessions = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const { fetch, drop } = plan(
    objects,
    localFiles(root, events),
    localSessions,
    Date.now() - argv.flags.days * 86_400_000,
  );

  await Promise.all(
    drop.flatMap((session) => [
      rm(join(root, session), { recursive: true, force: true }),
      rm(join(events, session), { recursive: true, force: true }),
    ]),
  );
  for (const session of fetch) {
    const source = `s3://${bucket}/${prefix}${session}`;
    // oxlint-disable-next-line no-await-in-loop -- one aws process at a time
    await $`aws s3 sync --only-show-errors --exclude ${`${MOD_EVENTS}/*`} ${source}/ ${join(root, session)}/`;
    // oxlint-disable-next-line no-await-in-loop -- one aws process at a time
    await $`aws s3 sync --only-show-errors ${source}/${MOD_EVENTS}/ ${join(events, session)}/`;
  }
  console.error(`${argv.flags.host}: fetched ${fetch.length} session(s), dropped ${drop.length}`);
}
