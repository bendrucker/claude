// One publish: diff the index's files against the lake's, then replace what changed in a
// single DuckLake commit.
import { z } from "zod";
import { enumerateHosts } from "../db";
import { isRemote, type LakeOptions, pullCatalog, pushCatalog, quote } from "./store";
import { loadViews, materializedViews } from "./views";
import { connect } from "./writer";

// Every view and these tables key on (host, session_id) and read only that session's
// rows, which is what lets a publish replace one session in isolation.
const SESSION_TABLES = ["content_items", "search_items"];
const FILE_TABLES = ["raw", "file_fields"];
const WHOLE_TABLES = ["meta", "index_meta"];

/**
 * Raw bytes of the sessions one batch of inserts covers. Each insert evaluates its view
 * and sorts its rows in memory.
 */
const BATCH_BYTES = 512 * 1024 * 1024;

const IN_FILES = "(host, source_file) IN (SELECT (host, source_file) FROM changed)";
// A correlated EXISTS plans as a delim join that buffers every row of the outer table,
// payload included, so the session filters are uncorrelated IN lists. coalesce keeps
// records without a session in their own group.
const SESSION = "(t.host, coalesce(t.session_id, ''))";
const inSessions = (from: string) =>
  `${SESSION} IN (SELECT (host, coalesce(session_id, '')) FROM ${from})`;
const IN_TOUCHED = inSessions("touched");

const Column = z.object({ db: z.string(), name: z.string(), col: z.string(), type: z.string() });
type Column = z.infer<typeof Column>;
const source = (t: string) => (t === "published_files" ? "indexed_files" : t);

export interface PublishResult {
  files: number;
  sessions: number;
}

function plan(columns: Column[], views: string[]) {
  const shape = (db: string, t: string) =>
    columns
      .filter((c) => c.db === db && c.name === t)
      .map((c) => `${c.col} ${c.type}`)
      .join(", ");
  const has = (t: string, col: string) =>
    columns.some((c) => c.db === "idx" && c.name === t && c.col === col);
  const tables = [...FILE_TABLES, ...SESSION_TABLES, ...WHOLE_TABLES, ...views];
  // When any table's columns no longer match the index's, the whole lake is rebuilt,
  // so no table keeps rows of files the index has since dropped.
  const all = ["published_files", ...tables];
  const drift = all.some(
    (t) => shape("lake", t) !== "" && shape("lake", t) !== shape("idx", source(t)),
  );
  return {
    tables,
    sessionTables: [...SESSION_TABLES, ...views],
    drifted: drift ? all.filter((t) => shape("lake", t) !== "") : [],
    has,
    // Clustering by record type first lets a filter on a rare type skip the row groups
    // of every other type, and a window still prunes within each type's run.
    order(t: string) {
      if (has(t, "timestamp"))
        return `${has(t, "type") ? "type, " : ""}timestamp NULLS FIRST, host`;
      return has(t, "session_id") ? "host, session_id" : "host, source_file";
    },
  };
}
type Plan = ReturnType<typeof plan>;

function stage(p: Plan, allowed: string): string[] {
  return [
    "BEGIN",
    ...p.drifted.map((t) => `DROP TABLE lake.${t}`),
    "CREATE TABLE IF NOT EXISTS lake.published_files AS FROM idx.indexed_files WITH NO DATA",
    ...p.tables.map((t) => `CREATE TABLE IF NOT EXISTS lake.${t} AS FROM idx.${t} WITH NO DATA`),
    `CREATE TEMP TABLE changed AS
      WITH now AS (FROM idx.indexed_files WHERE ${allowed})
      SELECT host, path AS source_file FROM (FROM now EXCEPT FROM lake.published_files)
      UNION
      SELECT host, path FROM (FROM lake.published_files EXCEPT FROM now)`,
    `CREATE TEMP TABLE touched AS
      SELECT DISTINCT host, session_id FROM idx.raw JOIN changed USING (host, source_file)
      UNION
      SELECT DISTINCT host, session_id FROM lake.raw JOIN changed USING (host, source_file)`,
    `CREATE TEMP TABLE batches AS
      SELECT host, session_id,
        floor(sum(bytes) OVER (ORDER BY first_ts NULLS FIRST, host, session_id) / ${BATCH_BYTES}) AS batch
      FROM (SELECT host, session_id, min(timestamp) AS first_ts, sum(strlen(data::VARCHAR)) AS bytes
        FROM idx.raw t WHERE ${allowed} AND ${IN_TOUCHED} GROUP BY ALL)`,
    ...FILE_TABLES.map((t) => `DELETE FROM lake.${t} WHERE ${IN_FILES}`),
    ...p.sessionTables.map((t) => `DELETE FROM lake.${t} t WHERE ${IN_TOUCHED}`),
    ...FILE_TABLES.filter((t) => !p.has(t, "session_id")).map(
      (t) => `INSERT INTO lake.${t} FROM idx.${t} WHERE ${IN_FILES} ORDER BY ${p.order(t)}`,
    ),
  ];
}

function insertBatch(p: Plan, allowed: string, batch: number): string[] {
  const inBatch = inSessions(`batches WHERE coalesce(batch, 0) = ${batch}`);
  return [
    ...FILE_TABLES.filter((t) => p.has(t, "session_id")).map(
      (t) =>
        `INSERT INTO lake.${t} FROM idx.${t} t WHERE ${IN_FILES} AND ${inBatch} ORDER BY ${p.order(t)}`,
    ),
    ...p.sessionTables.map(
      (t) =>
        `INSERT INTO lake.${t} FROM idx.${t} t WHERE ${allowed} AND ${inBatch} ORDER BY ${p.order(t)}`,
    ),
  ];
}

function finish(allowed: string): string[] {
  return [
    ...WHOLE_TABLES.flatMap((t) => [
      `DELETE FROM lake.${t}`,
      `INSERT INTO lake.${t} FROM idx.${t}${t === "meta" ? ` WHERE ${allowed}` : ""}`,
    ]),
    "DELETE FROM lake.published_files WHERE (host, path) IN (SELECT (host, source_file) FROM changed)",
    `INSERT INTO lake.published_files
      SELECT f.* FROM idx.indexed_files f JOIN changed c ON c.host = f.host AND c.source_file = f.path`,
  ];
}

async function refuseBlockedHosts(o: LakeOptions): Promise<void> {
  const hosts = await enumerateHosts(
    o.importsDir === undefined ? {} : { importsDir: o.importsDir },
  );
  const blocked = hosts.filter((h) => o.hosts.includes(h.host) && h.policy.block_egress === true);
  if (blocked.length > 0)
    throw new Error(
      `Refusing to publish hosts imported without --egress: ${blocked.map((h) => h.host).join(", ")}`,
    );
}

/**
 * One DuckLake commit: the files whose (mtime, size) differ from the last publish, and
 * every session they touch, before or after the change. A remote catalog is uploaded
 * only after the commit, and its Parquet files are immutable, so a reader sees the
 * previous snapshot or this one.
 */
export async function publish(o: LakeOptions): Promise<PublishResult> {
  await refuseBlockedHosts(o);
  const views = materializedViews(await loadViews());
  if (isRemote(o.url)) await pullCatalog(o);
  const db = await connect(o);
  const allowed = `host IN (${o.hosts.map(quote).join(", ")})`;
  let result: PublishResult;
  try {
    const columns = await db.rows(
      `SELECT database_name AS db, table_name AS name, column_name AS col, data_type AS type
        FROM duckdb_columns() WHERE database_name IN ('idx', 'lake') ORDER BY column_index`,
      Column,
    );
    const p = plan(columns, views);
    await db.script(stage(p, allowed));
    const batches = await db.rows(
      "SELECT DISTINCT coalesce(batch, 0)::INTEGER AS batch FROM batches ORDER BY batch",
      z.object({ batch: z.number() }),
    );
    for (const { batch } of batches)
      // oxlint-disable-next-line no-await-in-loop -- one connection inside one transaction.
      await db.script(insertBatch(p, allowed, batch));
    await db.script(finish(allowed));
    result = {
      files: await db.count("SELECT count(*) AS n FROM changed"),
      sessions: await db.count("SELECT count(*) AS n FROM touched"),
    };
    await db.run("COMMIT");
  } finally {
    db.close();
  }
  if (isRemote(o.url) && result.files > 0) await pushCatalog(o);
  return result;
}
