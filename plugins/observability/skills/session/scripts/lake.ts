#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: writes the catalog copy and spill files into the index dir,
// outside the sandbox's writable paths.
// Publishes the session index to a DuckLake that remote readers query in place, and
// writes the init file those readers open it with. The SQL under resources/lake/ does
// the work in the DuckDB CLI. This wrapper checks egress, moves the catalog to and from
// S3, and attaches the index and lake.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";
import { enumerateHosts, getDataDir, LOCAL_HOST, sessionDbPath } from "./db";

const RESOURCES_DIR = join(import.meta.dirname, "..", "resources");
const LAKE_SQL = join(RESOURCES_DIR, "lake");
// Table macros that read the refresh's scope tables bind them when created, so a
// reader cannot define them.
const WRITER_MACROS = new Set(["content_item_rows", "search_item_rows", "field_rows"]);

export interface LakeOptions {
  /** `s3://bucket/prefix` or a local directory, holding `catalog.ducklake` and `data/`. */
  url: string;
  /** Hosts to publish. Every other host stays local. */
  hosts: string[];
  /** The local index to publish from. */
  index: string;
  /** Where the writer keeps its copy of a remote catalog and spills. */
  stateDir: string;
  /** Imported hosts' root, for their egress policy. */
  importsDir?: string;
}

const isRemote = (url: string) => url.startsWith("s3://");
const catalogUrl = (url: string) => `${url.replace(/\/$/, "")}/catalog.ducklake`;
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const read = (path: string) => Bun.file(join(RESOURCES_DIR, path)).text();

// A remote catalog's local copy is keyed by its URL, so two lakes never share one.
const localCatalog = (o: LakeOptions) =>
  isRemote(o.url)
    ? join(
        o.stateDir,
        "lake",
        createHash("sha256").update(o.url).digest("hex").slice(0, 12),
        "catalog.ducklake",
      )
    : catalogUrl(o.url);

/** Refuses any host but local unless its import manifest allows egress. */
async function refuseBlockedHosts(o: LakeOptions): Promise<void> {
  const known = await enumerateHosts(
    o.importsDir === undefined ? {} : { importsDir: o.importsDir },
  );
  const allowed = (host: string) =>
    host === LOCAL_HOST || known.find((h) => h.host === host)?.policy.block_egress === false;
  const blocked = o.hosts.filter((h) => !allowed(h));
  if (blocked.length > 0)
    throw new Error(`Refusing to publish hosts not imported with --egress: ${blocked.join(", ")}`);
}

// Always starts from the remote catalog, so a stale copy from another machine or an
// earlier run never overwrites newer snapshots. Only a missing object starts a new lake.
async function pullCatalog(o: LakeOptions): Promise<void> {
  const local = localCatalog(o);
  mkdirSync(dirname(local), { recursive: true });
  await rm(local, { force: true });
  const listed = await $`aws s3 ls ${catalogUrl(o.url)}`.nothrow().quiet();
  if (listed.exitCode === 0) await $`aws s3 cp --only-show-errors ${catalogUrl(o.url)} ${local}`;
  else if (listed.exitCode !== 1 || listed.stderr.length > 0)
    throw new Error(`aws s3 ls ${catalogUrl(o.url)} failed: ${listed.stderr.toString().trim()}`);
}

/** Runs `script` in the DuckDB CLI with the index and lake attached, and returns stdout. */
async function runWriter(o: LakeOptions, script: string): Promise<string> {
  if (isRemote(o.url)) await pullCatalog(o);
  else mkdirSync(join(o.url, "data"), { recursive: true });
  mkdirSync(join(o.stateDir, "lake"), { recursive: true });
  const work = mkdtempSync(join(o.stateDir, "lake", "run-"));
  const header = [
    `.read ${join(LAKE_SQL, "writer.sql")}`,
    isRemote(o.url) ? `.read ${join(LAKE_SQL, "s3.sql")}` : "",
    `ATTACH ${quote(o.index)} AS idx (READ_ONLY);`,
    `ATTACH ${quote(`ducklake:${localCatalog(o)}`)} AS lake (DATA_PATH ${quote(`${o.url.replace(/\/$/, "")}/data/`)});`,
    `SET VARIABLE hosts = [${o.hosts.map(quote).join(", ")}]::VARCHAR[];`,
    `.read ${join(LAKE_SQL, script)}`,
  ].join("\n");
  try {
    const out = await $`duckdb -bail :memory: < ${Buffer.from(header)}`.cwd(work).quiet();
    return out.stdout.toString();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function pushCatalog(o: LakeOptions): Promise<void> {
  if (isRemote(o.url))
    await $`aws s3 cp --only-show-errors ${localCatalog(o)} ${catalogUrl(o.url)}`;
}

const PublishResult = z.object({ files: z.number(), sessions: z.number(), rebuilt: z.boolean() });
export type PublishResult = z.infer<typeof PublishResult>;

/**
 * One DuckLake commit of what changed since the last publish. A remote catalog is
 * uploaded only after the commit, and its Parquet files are immutable, so a reader sees
 * the previous snapshot or this one.
 */
export async function publish(o: LakeOptions): Promise<PublishResult> {
  await refuseBlockedHosts(o);
  const out = (await runWriter(o, "publish.sql")).trim().split("\n").at(-1) ?? "";
  const result = PublishResult.parse(JSON.parse(out));
  if (result.files > 0 || result.rebuilt) await pushCatalog(o);
  return result;
}

export async function checkpoint(o: LakeOptions): Promise<void> {
  await runWriter(o, "checkpoint.sql");
  await pushCatalog(o);
}

/**
 * What a reader runs before its query: limits, the read-only attach, and the macros.
 * Every table and view the index has is a lake table, which unqualified names resolve to.
 */
export async function readerInit(url: string): Promise<string> {
  const views = await read("views.sql");
  // views.sql cut at each top-level CREATE, keeping the macros a reader can define.
  const starts = [...views.matchAll(/^CREATE OR REPLACE (VIEW|MACRO|TABLE) (\w+)/gm)];
  const macros = starts
    .map((m, i) => ({ m, sql: views.slice(m.index, starts[i + 1]?.index ?? views.length) }))
    .filter(({ m }) => m[1] === "MACRO" && !WRITER_MACROS.has(m[2] ?? ""))
    .map(({ sql }) => sql.trim());
  return [
    await read("limits.sql"),
    isRemote(url) ? await read("lake/s3.sql") : "",
    "INSTALL ducklake; LOAD ducklake;",
    `ATTACH ${quote(`ducklake:${catalogUrl(url)}`)} AS lake (READ_ONLY);`,
    "SET search_path = 'memory.main,lake.main';",
    await read("schema/00_pinned.sql"),
    await read("schema/03_macros.sql"),
    ...macros,
  ].join("\n");
}

/** Writes the reader init for `url` under $TMPDIR, keyed by its content, and returns the path. */
async function writeReaderInit(url: string): Promise<string> {
  const sql = await readerInit(url);
  const hash = createHash("sha256").update(sql).digest("hex").slice(0, 12);
  const path = join(tmpdir(), "claude-session-lake", `${hash}.sql`);
  if (!(await Bun.file(path).exists())) await Bun.write(path, sql);
  return path;
}

if (import.meta.main) {
  const argv = cli({
    name: "lake",
    parameters: ["<command>"],
    help: {
      description:
        "publish: copy what changed in the local index to the lake. checkpoint: run DuckLake maintenance. init: print the path of a reader init file, for `duckdb -init`.",
    },
    flags: {
      url: {
        type: String,
        description:
          "Lake location, s3://bucket/prefix or a directory (default: $CLAUDE_SESSION_LAKE_URL)",
        default: process.env.CLAUDE_SESSION_LAKE_URL ?? "",
      },
      host: {
        type: [String],
        description: `Host to publish, repeatable (default: ${LOCAL_HOST})`,
      },
      stateDir: {
        type: String,
        description:
          "Where the writer keeps its catalog copy and spill files (default: the index dir)",
      },
    },
  });
  const url = argv.flags.url;
  if (url === "") throw new Error("Set --url or CLAUDE_SESSION_LAKE_URL.");
  const dataDir = getDataDir();
  const options: LakeOptions = {
    url,
    hosts: argv.flags.host.length > 0 ? argv.flags.host : [LOCAL_HOST],
    index: sessionDbPath(dataDir),
    stateDir: argv.flags.stateDir ?? dataDir,
  };
  switch (argv._.command) {
    case "publish":
      console.error(JSON.stringify(await publish(options)));
      break;
    case "checkpoint":
      await checkpoint(options);
      break;
    case "init":
      console.log(await writeReaderInit(url));
      break;
    default:
      throw new Error(`Unknown command: ${argv._.command}`);
  }
}
