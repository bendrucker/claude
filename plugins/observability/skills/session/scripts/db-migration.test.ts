import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { compactDatabase, ensureIndex, ensureSchema } from "./db";
import {
  db,
  importFixtureHost,
  importsDir,
  reindex,
  reopenDb,
  tmpDir,
  useFixtureIndex,
} from "./db.fixture";

useFixtureIndex();

describe("view versioning", () => {
  it("rebuilds views when the stored fingerprint is stale, even with no file changes", async () => {
    await db.run("DROP VIEW tool_calls");
    await db.run("UPDATE index_meta SET views_hash = 'stale'");
    await reindex();

    const rows = await db.query(
      "SELECT tool_name FROM tool_calls LIMIT 1",
      z.object({ tool_name: z.string() }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("skips the rebuild when the fingerprint matches and no files changed", async () => {
    await db.run("DROP VIEW tool_calls");
    await reindex();

    expect(db.query("SELECT * FROM tool_calls LIMIT 1", z.unknown())).rejects.toThrow();
  });
});

describe("pinned column derivation", () => {
  // A root that does not exist is skipped rather than read, so ensureIndex touches no
  // file and anything that changes in raw came from raw itself.
  async function reindexWithoutDisk() {
    const gone = join(tmpDir, "gone");
    await ensureIndex(db, { projectsDir: gone, importsDir: gone });
  }

  it("re-derives the projected columns from raw.data without re-reading the files", async () => {
    await db.run("UPDATE raw SET session_id = 'clobbered', input_tokens = -1");
    await db.run("UPDATE index_meta SET import_hash = 'stale'");

    await reindexWithoutDisk();

    const [row] = await db.query(
      `
      SELECT
        COUNT(*) AS n,
        COUNT(*) FILTER (WHERE session_id = 'clobbered') AS clobbered,
        COUNT(*) FILTER (WHERE input_tokens = -1) AS negative
      FROM raw
    `,
      z.object({ n: z.bigint(), clobbered: z.bigint(), negative: z.bigint() }),
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
    expect(Number(row?.clobbered)).toBe(0);
    expect(Number(row?.negative)).toBe(0);
  });

  it("rebuilds the tables derived from raw after a re-derivation", async () => {
    await db.run("DROP VIEW tool_calls");
    await db.run("UPDATE index_meta SET import_hash = 'stale'");

    await reindexWithoutDisk();

    const rows = await db.query(
      "SELECT tool_name FROM tool_calls LIMIT 1",
      z.object({ tool_name: z.string() }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  // A rewritten raw leaves content_items holding rows from the projection that was just
  // replaced. Nothing about that table says so, so the marker has to be written before
  // the rewrite for an interrupted run to be recoverable.
  it("marks the derived tables stale before rewriting raw", async () => {
    await db.run("UPDATE index_meta SET import_hash = 'stale'");

    // ensureSchema is everything a refresh does before it can reach rebuildViews, so
    // stopping here is the widest crash window the rewrite opens.
    await ensureSchema(db);
    const [marker] = await db.query(
      "SELECT views_hash FROM index_meta",
      z.object({ views_hash: z.string().nullable() }),
    );
    expect(marker?.views_hash).toBeNull();

    // The fingerprint is current again now, and no file changed, so the marker is the
    // only thing left asking for the rebuild.
    await db.run("DELETE FROM content_items");
    await reindexWithoutDisk();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM content_items",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });

  it("records the fingerprint without rewriting an index that predates the check", async () => {
    await db.run("UPDATE raw SET session_id = 'untouched'");
    await db.run("UPDATE index_meta SET import_hash = NULL");

    await reindexWithoutDisk();

    const [row] = await db.query(
      `
      SELECT
        (SELECT COUNT(*) FROM raw WHERE session_id = 'untouched') AS untouched,
        (SELECT import_hash FROM index_meta) AS hash
    `,
      z.object({ untouched: z.bigint(), hash: z.string().nullable() }),
    );
    expect(Number(row?.untouched)).toBeGreaterThan(0);
    expect(row?.hash).not.toBeNull();
  });

  // The projection can change between an index's build and the first run that stamps
  // it. Stamping over a raw that still carries a dropped column left every later
  // import failing on a column-count mismatch.
  it("rewrites an unstamped index whose columns no longer match the projection", async () => {
    await db.run("ALTER TABLE raw ADD COLUMN summary VARCHAR");
    await db.run("UPDATE index_meta SET import_hash = NULL");

    const rewritten = await ensureSchema(db);
    expect(rewritten).toBe(true);

    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'raw'",
      z.object({ column_name: z.string() }),
    );
    expect(columns.map((c) => c.column_name)).not.toContain("summary");

    // Invalidating the catalog's stats sends every fixture back through import.sql,
    // which is where the column-count mismatch used to surface.
    await db.run("UPDATE indexed_files SET mtime = -1, size = -1");
    await reindex();
    const [row] = await db.query("SELECT COUNT(*) AS n FROM raw", z.object({ n: z.bigint() }));
    expect(Number(row?.n)).toBeGreaterThan(0);
  });

  // An adopted index may already carry a content_items left behind a committed import by
  // the code that built it, and its hashes and catalog all read as current.
  it("rebuilds the derived tables when adopting an index that predates the check", async () => {
    await db.run("UPDATE index_meta SET import_hash = NULL");
    await db.run("DELETE FROM content_items");

    await reindexWithoutDisk();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM content_items",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });
});

describe("index version migration", () => {
  // A run that drops content_items and dies before rebuilding it leaves the catalog
  // current and views_hash unchanged, so nothing else would ask for the rebuild.
  it("rebuilds a derived table an interrupted run left behind", async () => {
    await db.run("DROP TABLE content_items");
    await reindex();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM content_items",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });

  it("re-imports every file instead of emptying the index", async () => {
    const [before] = await db.query("SELECT COUNT(*) AS n FROM raw", z.object({ n: z.bigint() }));

    await db.run("UPDATE raw SET type = 'clobbered'");
    await db.run("UPDATE index_meta SET version = 0");
    await reindex();

    const [after] = await db.query(
      `
      SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE type = 'clobbered') AS clobbered FROM raw
    `,
      z.object({ n: z.bigint(), clobbered: z.bigint() }),
    );
    expect(after?.n).toBe(before?.n);
    expect(Number(after?.clobbered)).toBe(0);
  });

  // The old migration dropped raw outright, so a host that happened to be unreachable
  // during the bump lost its whole corpus: ensureIndex skips a missing root, so nothing
  // ever re-imported it.
  it("keeps rows for a host whose root is unreachable", async () => {
    await importFixtureHost("detached");
    await reindex();
    const [before] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'detached'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(before?.n)).toBeGreaterThan(0);

    await rm(join(importsDir, "detached", "projects"), { recursive: true, force: true });
    await db.run("UPDATE index_meta SET version = 0");
    await reindex();

    const [after] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'detached'",
      z.object({ n: z.bigint() }),
    );
    expect(after?.n).toBe(before?.n);
  });

  it("still drops rows for files deleted from disk", async () => {
    await importFixtureHost("archived");
    await reindex();

    const projects = join(importsDir, "archived", "projects");
    await rm(projects, { recursive: true, force: true });
    mkdirSync(projects, { recursive: true });

    await db.run("UPDATE index_meta SET version = 0");
    await reindex();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'archived'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBe(0);
  });
});

describe("compactDatabase", () => {
  it("rewrites the file preserving tables, views, and macros", async () => {
    const [before] = await db.query("SELECT COUNT(*) AS n FROM raw", z.object({ n: z.bigint() }));
    db.close();

    await compactDatabase(tmpDir);

    await reopenDb();
    const [after] = await db.query("SELECT COUNT(*) AS n FROM raw", z.object({ n: z.bigint() }));
    expect(after?.n).toBe(before?.n);
    // sessions exercises both a view and the project_id macro.
    const sessions = await db.query(
      "SELECT session_id FROM sessions",
      z.object({ session_id: z.string() }),
    );
    expect(sessions.length).toBeGreaterThan(0);
  });
});
