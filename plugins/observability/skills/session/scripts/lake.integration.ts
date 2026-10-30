import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import { ensureIndex, getDb, sessionDbPath } from "./db";
import { LakeBudgetError, type LakeOptions, publish, queryLake, readerInit } from "./lake";

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");

let dir: string;
let projects: string;
let imports: string;
let options: LakeOptions;

async function refresh() {
  const db = await getDb(dir);
  try {
    await ensureIndex(db, { projectsDir: projects, importsDir: imports });
  } finally {
    db.close();
  }
}

async function withLake<T>(run: (c: DuckDBConnection) => Promise<T>, readOnly = true): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:");
  const c = await instance.connect();
  try {
    await c.run("LOAD ducklake");
    await c.run(`ATTACH '${options.index}' AS idx (READ_ONLY)`);
    await c.run(
      `ATTACH 'ducklake:${join(options.url, "catalog.ducklake")}' AS lake${readOnly ? " (READ_ONLY)" : ""}`,
    );
    return await run(c);
  } finally {
    c.closeSync();
    instance.closeSync();
  }
}

// Every lake table with a host column, which the drift check scopes to the local host.
const tables = () =>
  withLake(async (c) =>
    z
      .array(z.object({ t: z.string() }))
      .parse(
        (
          await c.runAndReadAll(
            `SELECT DISTINCT table_name AS t FROM duckdb_columns()
              WHERE database_name = 'lake' AND column_name = 'host' AND table_name NOT IN ('published_files', 'published_sessions')
              ORDER BY 1`,
          )
        ).getRowObjectsJS(),
      )
      .map((r) => r.t),
  );

// Rows the lake holds that the local index does not, and the reverse, per table.
async function drift(names: string[]): Promise<Record<string, number>> {
  return withLake(async (c) => {
    const sql = names
      .map((t) => {
        const local = `SELECT * FROM idx.${t} WHERE host = 'local'`;
        return `SELECT '${t}' AS t,
          (SELECT count(*) FROM (${local} EXCEPT ALL FROM lake.${t}))
            + (SELECT count(*) FROM (FROM lake.${t} EXCEPT ALL ${local})) AS n`;
      })
      .join(" UNION ALL ");
    const rows = z
      .array(z.object({ t: z.string(), n: z.union([z.bigint(), z.number()]) }))
      .parse((await c.runAndReadAll(sql)).getRowObjectsJS());
    return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
  });
}

const clean = (ts: string[]) => Object.fromEntries(ts.map((t) => [t, 0]));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "session-lake-"));
  projects = join(dir, "projects");
  imports = join(dir, "imports");
  await $`cp -R ${fixturesDir}/. ${projects}`.quiet();
  // An imported host holding a copy of the local corpus, which the lake must never see.
  mkdirSync(join(imports, "work"), { recursive: true });
  await $`cp -R ${fixturesDir}/. ${join(imports, "work", "projects")}`.quiet();
  await Bun.write(
    join(imports, "work", "manifest.json"),
    JSON.stringify({ host: "work", source: "test", imported_at: "2026-10-21", policy: {} }),
  );
  options = {
    url: join(dir, "lake"),
    hosts: ["local"],
    index: sessionDbPath(dir),
    stateDir: dir,
    importsDir: imports,
  };
  await refresh();
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// What a promise rejected with, or undefined when it resolved.
const failure = (p: Promise<unknown>) => p.then(() => undefined).catch((error: unknown) => error);

describe("publish", () => {
  test("a first publish matches the local index for the published hosts", async () => {
    const db = await getDb(dir);
    const hosts = await db
      .query("SELECT DISTINCT host FROM raw ORDER BY 1", z.object({ host: z.string() }))
      .finally(() => {
        db.close();
      });
    expect(hosts.map((h) => h.host)).toEqual(["local", "work"]);

    const result = await publish(options);
    expect(result.files).toBeGreaterThan(0);
    expect(result.macros).toBeGreaterThan(0);
    const ts = await tables();
    expect(ts).toContain("messages");
    expect(await drift(ts)).toEqual(clean(ts));
    const partitioned = await withLake(async (c) =>
      (
        await c.runAndReadAll(
          `SELECT DISTINCT t.table_name FROM __ducklake_metadata_lake.ducklake_partition_info p
            JOIN __ducklake_metadata_lake.ducklake_table t USING (table_id) ORDER BY 1`,
        )
      ).getRowsJS(),
    );
    expect(partitioned.flat()).toContain("messages");
  }, 120_000);

  // A republish deletes a session's rows only from its earliest raw timestamp on.
  test("no published row precedes its session's earliest raw timestamp", async () => {
    const early = await withLake(async (c) => {
      const keyed = z.array(z.object({ t: z.string() })).parse(
        (
          await c.runAndReadAll(
            `SELECT table_name AS t FROM duckdb_columns() WHERE database_name = 'lake'
              GROUP BY 1 HAVING bool_or(column_name = 'timestamp') AND bool_or(column_name = 'session_id')`,
          )
        ).getRowObjectsJS(),
      );
      const sql = keyed
        .map(
          ({ t }) => `SELECT '${t}' AS t, count(*) AS n FROM lake.${t} x
            JOIN lake.published_sessions p USING (host, session_id) WHERE x.timestamp < p.since`,
        )
        .join(" UNION ALL ");
      return (await c.runAndReadAll(sql)).getRowObjectsJS().filter((r) => Number(r.n) > 0);
    });
    expect(early).toEqual([]);
  }, 60_000);

  test("a reader's init resolves the index's tables and macros in the lake", async () => {
    const init = join(dir, "reader.sql");
    await Bun.write(init, await readerInit(options.url));
    const sql = `SET VARIABLE after_date = NULL; SET VARIABLE before_date = NULL;
      SET VARIABLE project = NULL; SET VARIABLE host = NULL;
      SELECT (SELECT count(*) FROM scoped_sessions()) = (SELECT count(*) FROM sessions) AS same;`;
    const out = await $`duckdb -json -init ${init} -c ${sql}`.cwd(dir).text();
    expect(JSON.parse(out)).toEqual([{ same: true }]);
  }, 60_000);

  test("a lake query prices its reads and refuses one over budget", async () => {
    const sql = "SELECT count(*) AS n FROM raw WHERE timestamp >= getvariable('after')";
    const all = await queryLake(options.url, sql, 1e9, { after: "2000-01-01" });
    expect(all.estimate).toBeGreaterThan(0);
    const none = await queryLake(options.url, sql, 1e9, { after: "2999-01-01" });
    expect(none).toMatchObject({ rows: [{ n: 0n }], estimate: 0 });
    expect(await failure(queryLake(options.url, sql, 1, { after: "2000-01-01" }))).toBeInstanceOf(
      LakeBudgetError,
    );
    expect(String(await failure(queryLake(options.url, "SELECT 1; SELECT 2", 1e9)))).toContain(
      "one statement",
    );
  }, 60_000);

  test("an unchanged index publishes nothing", async () => {
    expect(await publish(options)).toEqual({ files: 0, sessions: 0, macros: 0, rebuilt: false });
  }, 60_000);

  test("a changed and a removed file republish only their sessions", async () => {
    const tools = join(projects, "-Users-test-project", "tools.jsonl");
    const text = await Bun.file(tools).text();
    await Bun.write(tools, `${text}${text.trim().split("\n").at(-1) ?? ""}\n`);
    await Bun.file(join(projects, "-Users-test-project", "replay.jsonl")).delete();
    await refresh();

    const result = await publish(options);
    expect(result.files).toBe(2);
    const ts = await tables();
    expect(await drift(ts)).toEqual(clean(ts));
  }, 120_000);

  test.each([
    ["a table's columns drift", "ALTER TABLE lake.messages ADD COLUMN stale INTEGER"],
    ["a table goes missing", "DROP TABLE lake.messages"],
    ["it predates published_sessions", "DROP TABLE lake.published_sessions"],
    ["the index's views fingerprint moves", "UPDATE lake.index_meta SET views_hash = 'stale'"],
  ])(
    "rebuilds the lake when %s",
    async (_, sql) => {
      await withLake((c) => c.run(sql), false);

      const result = await publish(options);
      expect(result.rebuilt).toBe(true);
      expect(result.files).toBeGreaterThan(2);
      const ts = await tables();
      expect(await drift(ts)).toEqual(clean(ts));
    },
    120_000,
  );

  test("refuses a host whose manifest sets no egress policy", async () => {
    const refused = await publish({ ...options, hosts: ["local", "work"] }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(String(refused)).toContain("work");
  });

  test("refuses a host imported without --egress", async () => {
    const manifest = join(imports, "work", "manifest.json");
    const original = await Bun.file(manifest).text();
    await Bun.write(
      manifest,
      JSON.stringify({ ...JSON.parse(original), policy: { block_egress: true } }),
    );
    try {
      const refused = await publish({ ...options, hosts: ["local", "work"] }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(Error);
      expect(String(refused)).toContain("work");
    } finally {
      await Bun.write(manifest, original);
    }
  });
});
