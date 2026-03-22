import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { type Database, ensureIndex, getDb, runQuery } from "./db";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");

let db: Database;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "session-test-"));
  db = await getDb(tmpDir);
  await ensureIndex(db, fixturesDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("digest", () => {
  it("returns sessions sorted by start time descending", async () => {
    const rows = await runQuery<{ start_time: string }>(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: null,
      limit: "20",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]?.start_time ?? "";
      const curr = rows[i]?.start_time ?? "";
      expect(prev >= curr).toBe(true);
    }
  });

  it("respects limit", async () => {
    const rows = await runQuery(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: null,
      limit: "2",
    });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("filters by date range", async () => {
    const rows = await runQuery<{ start_time: string }>(db, "digest", {
      after_date: "2024-01-17T00:00:00.000Z",
      before_date: null,
      project: null,
      session_id: null,
      limit: "20",
    });
    for (const row of rows) {
      expect(new Date(row.start_time).getTime()).toBeGreaterThanOrEqual(
        new Date("2024-01-17T00:00:00.000Z").getTime(),
      );
    }
  });

  it("filters by session ID", async () => {
    const rows = await runQuery<{ session_id: string }>(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: "basic-session",
      limit: "20",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_id).toBe("basic-session");
  });

  it("includes summary when present", async () => {
    const rows = await runQuery<{ summary: string }>(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: "summary-session",
      limit: "20",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe(
      "Fixed database connection pooling issue causing timeouts under load",
    );
  });

  it("includes project metadata", async () => {
    const rows = await runQuery<{ project_path: string; git_branch: string }>(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: "basic-session",
      limit: "20",
    });
    expect(rows[0]?.project_path).toBe("/Users/test/project");
    expect(rows[0]?.git_branch).toBe("main");
  });
});

describe("search", () => {
  it("finds sessions matching keyword", async () => {
    const rows = await runQuery(db, "search", {
      query: "error",
      after_date: null,
      before_date: null,
      project: null,
      limit: "10",
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", async () => {
    const rows = await runQuery(db, "search", {
      query: "zzzznonexistentzzzz",
      after_date: null,
      before_date: null,
      project: null,
      limit: "10",
    });
    expect(rows).toHaveLength(0);
  });

  it("filters by project", async () => {
    const rows = await runQuery<{ project_path: string }>(db, "search", {
      query: "authentication",
      after_date: null,
      before_date: null,
      project: "webapp",
      limit: "10",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.project_path).toContain("webapp");
    }
  });

  it("respects limit", async () => {
    const rows = await runQuery(db, "search", {
      query: "the",
      after_date: null,
      before_date: null,
      project: null,
      limit: "2",
    });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("matches summary content", async () => {
    const rows = await runQuery<{ session_id: string }>(db, "search", {
      query: "database connection pooling",
      after_date: null,
      before_date: null,
      project: null,
      limit: "10",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.session_id === "summary-session")).toBe(true);
  });
});

describe("stats", () => {
  it("aggregates tool usage", async () => {
    const rows = await runQuery<{ tool_name: string; uses: number }>(db, "stats", {
      after_date: null,
      before_date: null,
      project: null,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tool_name).toBeTruthy();
      expect(row.uses).toBeGreaterThan(0);
    }
  });

  it("sorts by uses descending", async () => {
    const rows = await runQuery<{ uses: number }>(db, "stats", {
      after_date: null,
      before_date: null,
      project: null,
    });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]?.uses).toBeGreaterThanOrEqual(rows[i]?.uses as number);
    }
  });

  it("includes aggregate totals", async () => {
    const rows = await runQuery<{ total_sessions: number; total_tool_uses: number }>(db, "stats", {
      after_date: null,
      before_date: null,
      project: null,
    });
    expect(rows[0]?.total_sessions).toBeGreaterThan(0);
    expect(rows[0]?.total_tool_uses).toBeGreaterThan(0);
  });
});

describe("errors", () => {
  it("returns error rows", async () => {
    const rows = await runQuery<{ error_content: string; tool_name: string; session_id: string }>(
      db,
      "errors",
      { after_date: null, before_date: null, project: null, error_type: null, limit: "20" },
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.error_content).toBeTruthy();
      expect(row.tool_name).toBeTruthy();
      expect(row.session_id).toBe("tools-session");
    }
  });

  it("classifies rejection and failure error types", async () => {
    const rows = await runQuery<{ error_type: string }>(db, "errors", {
      after_date: null,
      before_date: null,
      project: null,
      error_type: null,
      limit: "20",
    });
    const types = rows.map((r) => r.error_type);
    expect(types).toContain("rejection");
    expect(types).toContain("failure");
  });

  it("filters by error_type", async () => {
    const rows = await runQuery<{ error_type: string }>(db, "errors", {
      after_date: null,
      before_date: null,
      project: null,
      error_type: "rejection",
      limit: "20",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.error_type).toBe("rejection");
    }
  });
});

describe("incremental refresh", () => {
  it("produces no duplicates on repeated indexing", async () => {
    const before = await runQuery(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: null,
      limit: "100",
    });

    await ensureIndex(db, fixturesDir);

    const after = await runQuery(db, "digest", {
      after_date: null,
      before_date: null,
      project: null,
      session_id: null,
      limit: "100",
    });

    expect(after).toEqual(before);
  });
});

describe("malformed JSONL", () => {
  it("imports valid messages from files with invalid lines", async () => {
    const rows = await runQuery<{ user_messages: number; assistant_messages: number }>(
      db,
      "digest",
      {
        after_date: null,
        before_date: null,
        project: null,
        session_id: "malformed-session",
        limit: "20",
      },
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.user_messages)).toBe(1);
    expect(Number(rows[0]?.assistant_messages)).toBe(1);
  });
});
