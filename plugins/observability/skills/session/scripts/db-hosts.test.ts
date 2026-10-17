import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { deleteHostRows, dirExists, forgetHost, invalidateDerived, runQuery } from "./db";
import {
  backdate,
  db,
  filterParams,
  importFixtureHost,
  importsDir,
  queryParams,
  reindex,
  useFixtureIndex,
} from "./db.fixture";

useFixtureIndex();

describe("cross-machine history", () => {
  it("tags imported rows with the host across sessions, messages, and content_items", async () => {
    await importFixtureHost("work");
    await reindex();

    for (const tbl of ["sessions", "messages", "content_items"]) {
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the suite; concurrent statements on it interleave.
      const rows = await db.query(
        `SELECT DISTINCT host FROM ${tbl} ORDER BY host`,
        z.object({ host: z.string() }),
      );
      expect(rows.map((r) => r.host)).toEqual(["local", "work"]);
    }
  });

  it("scopes to a host with host= and spans all hosts without it", async () => {
    await importFixtureHost("work");
    await reindex();

    const scoped = await runQuery(
      db,
      "search",
      z.object({ host: z.string() }),
      queryParams({ host: "work", query: "error" }),
    );
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((r) => r.host === "work")).toBe(true);

    const spanned = await runQuery(
      db,
      "search",
      z.object({ host: z.string() }),
      queryParams({ query: "error" }),
    );
    expect(new Set(spanned.map((r) => r.host))).toEqual(new Set(["local", "work"]));

    const scopedStats = await runQuery(
      db,
      "stats",
      z.object({ total_sessions: z.bigint() }),
      filterParams({ host: "work" }),
    );
    const allStats = await runQuery(
      db,
      "stats",
      z.object({ total_sessions: z.bigint() }),
      filterParams(),
    );
    expect(Number(allStats[0]?.total_sessions)).toBe(Number(scopedStats[0]?.total_sessions) * 2);
  });

  it("indexes a host whose files predate the local import", async () => {
    // Imported files can carry mtimes far older than anything already indexed
    // (rsync -a preserves source mtimes). The per-file catalog keys on path +
    // (mtime, size), so an old-mtime file on a new host is still a new path.
    await importFixtureHost("archive");
    for (const rel of ["-Users-test-project/basic.jsonl", "-Users-test-webapp/webapp.jsonl"]) {
      // oxlint-disable-next-line no-await-in-loop -- two fixture files; concurrency buys nothing.
      await backdate(join(importsDir, "archive", "projects", rel));
    }
    await reindex();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM sessions WHERE host = 'archive'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });

  it("forget removes a host's rows and synced files", async () => {
    await importFixtureHost("gone");
    await reindex();
    const [before] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'gone'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(before?.n)).toBeGreaterThan(0);

    const removed = await forgetHost(db, "gone");
    expect(removed).toBe(Number(before?.n));
    await rm(join(importsDir, "gone"), { recursive: true, force: true });

    const [after] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'gone'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(after?.n)).toBe(0);
    const sessions = await db.query(
      "SELECT DISTINCT host FROM sessions ORDER BY host",
      z.object({ host: z.string() }),
    );
    expect(sessions.map((r) => r.host)).toEqual(["local"]);
    expect(dirExists(join(importsDir, "gone"))).toBe(false);
  });

  // forget marks the derived tables stale before it deletes, which is what makes the
  // removal durable: its own rebuild may not run, and the host's files are already gone,
  // so no later refresh sees a change that would ask for one.
  it("drops a forgotten host from the derived tables after an interrupted forget", async () => {
    await importFixtureHost("gone");
    await reindex();

    await invalidateDerived(db);
    await deleteHostRows(db, "gone");
    await rm(join(importsDir, "gone"), { recursive: true, force: true });

    await reindex();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM content_items WHERE host = 'gone'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBe(0);
  });

  it("keeps the same session distinct across hosts without merging or dropping", async () => {
    await importFixtureHost("alpha");
    await importFixtureHost("beta");
    await reindex();

    const hosts = await db.query(
      "SELECT host FROM sessions WHERE session_id = 'basic-session' ORDER BY host",
      z.object({ host: z.string() }),
    );
    expect(hosts.map((r) => r.host)).toEqual(["alpha", "beta", "local"]);

    const counts = await db.query(
      "SELECT host, COUNT(*) AS n FROM sessions GROUP BY host ORDER BY host",
      z.object({ host: z.string(), n: z.bigint() }),
    );
    expect(counts.map((r) => r.host)).toEqual(["alpha", "beta", "local"]);
    const distinct = new Set(counts.map((r) => Number(r.n)));
    expect(distinct.size).toBe(1);
    expect([...distinct][0]).toBeGreaterThan(0);
  });
});

describe("change catalog", () => {
  it("indexes a file rsynced in with an old mtime after the host was imported", async () => {
    await importFixtureHost("work");
    await reindex();

    // rsync -a re-syncs deliver new files with preserved (old) source mtimes.
    const late = join(importsDir, "work", "projects", "-Users-test-project", "late.jsonl");
    await Bun.write(
      late,
      `${JSON.stringify({
        type: "user",
        sessionId: "late-session",
        cwd: "/Users/test/project",
        timestamp: "2024-01-15T10:00:00.000Z",
        message: { role: "user", content: "hello from the past" },
      })}\n`,
    );
    await backdate(late);
    await reindex();

    const rows = await db.query(
      "SELECT session_id FROM raw WHERE session_id = 'late-session'",
      z.object({ session_id: z.string() }),
    );
    expect(rows).toHaveLength(1);
  });

  it("reimports a file whose content changed and drops its stale rows", async () => {
    await importFixtureHost("edited");
    await reindex();
    const target = join(importsDir, "edited", "projects", "-Users-test-project", "basic.jsonl");
    const original = await Bun.file(target).text();
    await Bun.write(
      target,
      `${original}${JSON.stringify({
        type: "user",
        sessionId: "basic-session",
        cwd: "/Users/test/project",
        timestamp: "2024-01-15T11:00:00.000Z",
        message: { role: "user", content: "appended line" },
      })}\n`,
    );
    await reindex();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'edited' AND source_file = $path",
      z.object({ n: z.bigint() }),
      { path: target },
    );
    const originalLines = original.trim().split("\n").length;
    expect(Number(row?.n)).toBe(originalLines + 1);
  });

  it("drops rows for files that disappear", async () => {
    await importFixtureHost("shrinking");
    await reindex();
    const target = join(importsDir, "shrinking", "projects", "-Users-test-project", "basic.jsonl");
    const [before] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'shrinking' AND source_file = $path",
      z.object({ n: z.bigint() }),
      { path: target },
    );
    expect(Number(before?.n)).toBeGreaterThan(0);

    await rm(target);
    await reindex();

    for (const table of ["raw", "content_items", "indexed_files"]) {
      const column = table === "indexed_files" ? "path" : "source_file";
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the suite; concurrent statements on it interleave.
      const [after] = await db.query(
        `SELECT COUNT(*) AS n FROM ${table} WHERE host = 'shrinking' AND ${column} = $path`,
        z.object({ n: z.bigint() }),
        { path: target },
      );
      expect(Number(after?.n)).toBe(0);
    }
  });

  it("keeps a host's rows when its root directory is missing", async () => {
    await importFixtureHost("unmounted");
    await reindex();
    await rm(join(importsDir, "unmounted", "projects"), { recursive: true, force: true });
    await reindex();

    const [row] = await db.query(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'unmounted'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });

  // chmod 000 does not restrict root, so the walk would succeed there
  it.skipIf(process.getuid?.() === 0)(
    "aborts and keeps a host's rows when the scan fails mid-walk",
    async () => {
      await importFixtureHost("guarded");
      await reindex();
      const [before] = await db.query(
        "SELECT COUNT(*) AS n FROM raw WHERE host = 'guarded'",
        z.object({ n: z.bigint() }),
      );
      expect(Number(before?.n)).toBeGreaterThan(0);

      const subdir = join(importsDir, "guarded", "projects", "-Users-test-project");
      await $`chmod 000 ${subdir}`.quiet();
      try {
        expect(reindex()).rejects.toThrow();
      } finally {
        await $`chmod 755 ${subdir}`.quiet();
      }

      const [after] = await db.query(
        "SELECT COUNT(*) AS n FROM raw WHERE host = 'guarded'",
        z.object({ n: z.bigint() }),
      );
      expect(Number(after?.n)).toBe(Number(before?.n));
    },
  );
});
