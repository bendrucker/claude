#!/usr/bin/env bun
// Publishes the session index to a DuckLake that remote readers query in place, and
// writes the init file those readers open it with. The local index stays the source of
// truth: each publish copies only the files that changed since the last one, and
// replaces the rows of every session those files touch.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";
import { enumerateHosts, getDataDir, LOCAL_HOST, sessionDbPath } from "./db";

const RESOURCES_DIR = join(import.meta.dirname, "..", "resources");

// Views over file_fields stay views: the registry is small and not session-scoped.
// classifier_verdicts reads mod_events, which is local telemetry and never published.
const KEPT_VIEWS = new Set(["fields", "field_triage", "view_paths"]);
const LOCAL_ONLY = new Set(["classifier_verdicts"]);
// Table macros that read the refresh's scope tables bind them when created, so a
// reader cannot define them.
const WRITER_MACROS = new Set(["content_item_rows", "search_item_rows", "field_rows"]);

// Every view and these tables key on (host, session_id) and read only that session's
// rows, which is what lets a publish replace one session in isolation.
const SESSION_TABLES = ["content_items", "search_items"];
const FILE_TABLES = ["raw", "file_fields"];
const WHOLE_TABLES = ["meta", "index_meta"];

// Rows sorted by time in small row groups, so a window filter skips most of a file.
const ROW_GROUP_SIZE = "8192";

export interface LakeOptions {
  /** `s3://bucket/prefix` or a local directory, holding `catalog.ducklake` and `data/`. */
  url: string;
  /** Hosts to publish. Every other host stays local. */
  hosts: string[];
  /** The local index to publish from. */
  index: string;
  /** Where the writer keeps its copy of a remote catalog between publishes. */
  stateDir: string;
  /** Imported hosts' root, for their egress policy. Defaults as in db.ts. */
  importsDir?: string;
}

const isRemote = (url: string) => url.startsWith("s3://");
const trimmed = (url: string) => url.replace(/\/$/, "");
export const catalogUrl = (url: string): string => `${trimmed(url)}/catalog.ducklake`;
const localCatalog = (o: LakeOptions) =>
  isRemote(o.url) ? join(o.stateDir, "lake", "catalog.ducklake") : catalogUrl(o.url);

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** httpfs on the ambient AWS credentials, trusting a proxy's CA bundle when one is set. */
function s3Setup(): string {
  const ca = process.env.AWS_CA_BUNDLE ?? process.env.SSL_CERT_FILE;
  const region = process.env.AWS_REGION ?? "us-east-1";
  return [
    "LOAD httpfs;",
    ca === undefined ? "" : `SET ca_cert_file = ${quote(ca)};`,
    `CREATE OR REPLACE SECRET lake_s3 (TYPE s3, PROVIDER credential_chain, REGION ${quote(region)});`,
  ].join("\n");
}

interface Statement {
  kind: string;
  name: string;
  sql: string;
}

/** views.sql cut at each top-level CREATE. Comments above one stay with the one before. */
export function viewStatements(sql: string): Statement[] {
  const starts = [...sql.matchAll(/^CREATE OR REPLACE (VIEW|MACRO|TABLE) (\w+)/gm)];
  return starts.map((m, i) => ({
    kind: m[1] ?? "",
    name: m[2] ?? "",
    sql: sql.slice(m.index, starts[i + 1]?.index ?? sql.length).trim(),
  }));
}

const loadViews = async () =>
  viewStatements(await Bun.file(join(RESOURCES_DIR, "views.sql")).text());

/** The views a publish writes as tables, so a reader's projection skips the JSON they parse. */
export function materializedViews(statements: Statement[]): string[] {
  return statements
    .filter((s) => s.kind === "VIEW" && !KEPT_VIEWS.has(s.name) && !LOCAL_ONLY.has(s.name))
    .map((s) => s.name);
}

/**
 * What a reader runs before its query: limits, the attach, and every macro and view the
 * lake does not hold as a table. Unqualified names resolve to the lake's tables.
 */
export async function readerInit(url: string): Promise<string> {
  const kept = (await loadViews()).filter((s) =>
    s.kind === "MACRO" ? !WRITER_MACROS.has(s.name) : KEPT_VIEWS.has(s.name),
  );
  const read = (name: string) => Bun.file(join(RESOURCES_DIR, name)).text();
  return [
    await read("limits.sql"),
    isRemote(url) ? s3Setup() : "",
    "LOAD ducklake;",
    `ATTACH ${quote(`ducklake:${catalogUrl(url)}`)} AS lake (READ_ONLY);`,
    "SET search_path = 'memory.main,lake.main';",
    await read("schema/00_pinned.sql"),
    await read("schema/03_macros.sql"),
    ...kept.map((s) => s.sql),
  ].join("\n");
}

const Count = z.object({ n: z.union([z.bigint(), z.number()]) });
const Column = z.object({ name: z.string(), col: z.string() });

async function connect(o: LakeOptions) {
  const instance = await DuckDBInstance.create(":memory:", { memory_limit: "4GiB", threads: "4" });
  const c = await instance.connect();
  const run = async (sql: string) => {
    await c.run(sql);
  };
  const rows = async <T>(sql: string, schema: z.ZodType<T>) =>
    z.array(schema).parse((await c.runAndReadAll(sql)).getRowObjectsJS());
  if (isRemote(o.url)) await run(s3Setup());
  else mkdirSync(join(o.url, "data"), { recursive: true });
  mkdirSync(dirname(localCatalog(o)), { recursive: true });
  await run("INSTALL ducklake; LOAD ducklake;");
  await run(`ATTACH ${quote(o.index)} AS idx (READ_ONLY)`);
  await run(
    `ATTACH ${quote(`ducklake:${localCatalog(o)}`)} AS lake (DATA_PATH ${quote(`${trimmed(o.url)}/data/`)})`,
  );
  await run(`CALL lake.set_option('parquet_row_group_size', ${quote(ROW_GROUP_SIZE)})`);
  return {
    run,
    rows,
    async script(statements: string[]) {
      for (const sql of statements)
        // oxlint-disable-next-line no-await-in-loop -- one connection, and each statement reads the last one's writes.
        await run(sql);
    },
    count: async (sql: string) => Number((await rows(sql, Count))[0]?.n ?? 0),
    close() {
      c.closeSync();
      instance.closeSync();
    },
  };
}

export interface PublishResult {
  files: number;
  sessions: number;
}

/**
 * One DuckLake commit: the files whose (mtime, size) differ from the last publish, and
 * every session they touch, before or after the change. A first publish is the same diff
 * against an empty lake. A remote catalog is uploaded only after the commit, and its
 * Parquet files are immutable, so a reader sees the previous snapshot or this one.
 */
export async function publish(o: LakeOptions): Promise<PublishResult> {
  const blocked = (
    await enumerateHosts(o.importsDir === undefined ? {} : { importsDir: o.importsDir })
  ).filter((h) => o.hosts.includes(h.host) && h.policy.block_egress === true);
  if (blocked.length > 0)
    throw new Error(
      `Refusing to publish hosts imported without --egress: ${blocked.map((h) => h.host).join(", ")}`,
    );
  const views = materializedViews(await loadViews());
  if (isRemote(o.url)) await pullCatalog(o);
  const db = await connect(o);
  const allowed = `host IN (${o.hosts.map(quote).join(", ")})`;
  try {
    const columns = await db.rows(
      "SELECT table_name AS name, column_name AS col FROM duckdb_columns() WHERE database_name = 'idx'",
      Column,
    );
    const has = (t: string, col: string) => columns.some((c) => c.name === t && c.col === col);
    // Clustering by record type first lets a filter on a rare type skip the row groups
    // of every other type, and a window still prunes within each type's run.
    const order = (t: string) => {
      if (has(t, "timestamp"))
        return `${has(t, "type") ? "type, " : ""}timestamp NULLS FIRST, host`;
      return has(t, "session_id") ? "host, session_id" : "host, source_file";
    };
    const inFiles = "(host, source_file) IN (SELECT (host, source_file) FROM changed)";
    const inSessions = `EXISTS (SELECT 1 FROM touched s
      WHERE s.host = t.host AND s.session_id IS NOT DISTINCT FROM t.session_id)`;

    await db.script([
      "CREATE TABLE IF NOT EXISTS lake.published_files AS FROM idx.indexed_files WITH NO DATA",
      ...[...FILE_TABLES, ...SESSION_TABLES, ...WHOLE_TABLES, ...views].map(
        (t) => `CREATE TABLE IF NOT EXISTS lake.${t} AS FROM idx.${t} WITH NO DATA`,
      ),
      "BEGIN",
      `CREATE TEMP TABLE changed AS
        WITH now AS (FROM idx.indexed_files WHERE ${allowed})
        SELECT host, path AS source_file FROM (FROM now EXCEPT FROM lake.published_files)
        UNION
        SELECT host, path FROM (FROM lake.published_files EXCEPT FROM now)`,
      `CREATE TEMP TABLE touched AS
        SELECT DISTINCT host, session_id FROM idx.raw JOIN changed USING (host, source_file)
        UNION
        SELECT DISTINCT host, session_id FROM lake.raw JOIN changed USING (host, source_file)`,
      ...FILE_TABLES.flatMap((t) => [
        `DELETE FROM lake.${t} WHERE ${inFiles}`,
        `INSERT INTO lake.${t} FROM idx.${t} WHERE ${inFiles} ORDER BY ${order(t)}`,
      ]),
      ...[...SESSION_TABLES, ...views].flatMap((t) => [
        `DELETE FROM lake.${t} t WHERE ${inSessions}`,
        `INSERT INTO lake.${t}
          FROM idx.${t} t WHERE ${allowed} AND ${inSessions} ORDER BY ${order(t)}`,
      ]),
      ...WHOLE_TABLES.flatMap((t) => [
        `DELETE FROM lake.${t}`,
        `INSERT INTO lake.${t} FROM idx.${t}${t === "meta" ? ` WHERE ${allowed}` : ""}`,
      ]),
      "DELETE FROM lake.published_files WHERE (host, path) IN (SELECT (host, source_file) FROM changed)",
      `INSERT INTO lake.published_files
        SELECT f.* FROM idx.indexed_files f JOIN changed c ON c.host = f.host AND c.source_file = f.path`,
    ]);
    const files = await db.count("SELECT count(*) AS n FROM changed");
    const sessions = await db.count("SELECT count(*) AS n FROM touched");
    await db.run("COMMIT");
    db.close();
    if (isRemote(o.url) && files > 0) await pushCatalog(o);
    return { files, sessions };
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * DuckLake's own maintenance: flush inlined rows, merge small files, expire snapshots
 * older than `olderThan`, and delete the files only those snapshots referenced. The
 * window must outlast the longest reader, which may still be reading an expired one.
 */
export async function checkpoint(o: LakeOptions, olderThan = "7 days"): Promise<void> {
  if (isRemote(o.url)) await pullCatalog(o);
  const db = await connect(o);
  try {
    await db.run(`CALL lake.set_option('expire_older_than', ${quote(olderThan)})`);
    await db.run(`CALL lake.set_option('delete_older_than', ${quote(olderThan)})`);
    await db.run("USE lake; CHECKPOINT;");
  } finally {
    db.close();
  }
  if (isRemote(o.url)) await pushCatalog(o);
}

// The writer is the only one that changes the catalog, so its local copy is current
// unless it is missing (a new machine, or a wiped state dir).
async function pullCatalog(o: LakeOptions): Promise<void> {
  const local = localCatalog(o);
  if (await Bun.file(local).exists()) return;
  mkdirSync(dirname(local), { recursive: true });
  const listed = await $`aws s3 ls ${catalogUrl(o.url)}`.nothrow().quiet();
  if (listed.exitCode === 0) await $`aws s3 cp --only-show-errors ${catalogUrl(o.url)} ${local}`;
}

async function pushCatalog(o: LakeOptions): Promise<void> {
  await $`aws s3 cp --only-show-errors ${localCatalog(o)} ${catalogUrl(o.url)}`;
}

/** Writes the reader init for `url` under $TMPDIR, keyed by its content, and returns the path. */
export async function writeReaderInit(url: string): Promise<string> {
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
    },
  });
  const url = argv.flags.url;
  if (url === "") throw new Error("Set --url or CLAUDE_SESSION_LAKE_URL.");
  const dataDir = getDataDir();
  const options: LakeOptions = {
    url,
    hosts: argv.flags.host.length > 0 ? argv.flags.host : [LOCAL_HOST],
    index: sessionDbPath(dataDir),
    stateDir: dataDir,
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
