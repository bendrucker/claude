import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { type Database, ensureIndex, getDb, runQuery } from "./db";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");

function digestParams(overrides: Record<string, string | null> = {}) {
  return {
    after_date: null,
    before_date: null,
    project: null,
    session_id: null,
    limit: "20",
    ...overrides,
  };
}

function filterParams(overrides: Record<string, string | null> = {}) {
  return { after_date: null, before_date: null, project: null, ...overrides };
}

function queryParams(overrides: Record<string, string | null> = {}) {
  return filterParams({ limit: "20", ...overrides });
}

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
    const rows = await runQuery<{ start_time: string }>(db, "digest", digestParams());
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]?.start_time ?? "";
      const curr = rows[i]?.start_time ?? "";
      expect(prev >= curr).toBe(true);
    }
  });

  it("respects limit", async () => {
    const rows = await runQuery(db, "digest", digestParams({ limit: "2" }));
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("filters by date range", async () => {
    const rows = await runQuery<{ start_time: string }>(
      db,
      "digest",
      digestParams({ after_date: "2024-01-17T00:00:00.000Z" }),
    );
    for (const row of rows) {
      expect(new Date(row.start_time).getTime()).toBeGreaterThanOrEqual(
        new Date("2024-01-17T00:00:00.000Z").getTime(),
      );
    }
  });

  it("filters by session ID", async () => {
    const rows = await runQuery<{ session_id: string }>(
      db,
      "digest",
      digestParams({ session_id: "basic-session" }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_id).toBe("basic-session");
  });

  it("includes summary when present", async () => {
    const rows = await runQuery<{ summary: string }>(
      db,
      "digest",
      digestParams({ session_id: "summary-session" }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe(
      "Fixed database connection pooling issue causing timeouts under load",
    );
  });

  it("includes project metadata", async () => {
    const rows = await runQuery<{ project_path: string; git_branch: string }>(
      db,
      "digest",
      digestParams({ session_id: "basic-session" }),
    );
    expect(rows[0]?.project_path).toBe("/Users/test/project");
    expect(rows[0]?.git_branch).toBe("main");
  });

  it("filters by before_date", async () => {
    const rows = await runQuery<{ start_time: string }>(
      db,
      "digest",
      digestParams({ before_date: "2024-01-16T00:00:00.000Z" }),
    );
    for (const row of rows) {
      expect(new Date(row.start_time).getTime()).toBeLessThanOrEqual(
        new Date("2024-01-16T00:00:00.000Z").getTime(),
      );
    }
  });
});

describe("search", () => {
  it("finds sessions matching keyword", async () => {
    const rows = await runQuery(db, "search", { query: "error", ...queryParams({ limit: "10" }) });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", async () => {
    const rows = await runQuery(db, "search", {
      query: "zzzznonexistentzzzz",
      ...queryParams({ limit: "10" }),
    });
    expect(rows).toHaveLength(0);
  });

  it("filters by project", async () => {
    const rows = await runQuery<{ project_path: string }>(db, "search", {
      query: "authentication",
      ...queryParams({ project: "webapp", limit: "10" }),
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.project_path).toContain("webapp");
    }
  });

  it("respects limit", async () => {
    const rows = await runQuery(db, "search", { query: "the", ...queryParams({ limit: "2" }) });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("matches summary content", async () => {
    const rows = await runQuery<{ session_id: string }>(db, "search", {
      query: "database connection pooling",
      ...queryParams({ limit: "10" }),
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.session_id === "summary-session")).toBe(true);
  });
});

describe("stats", () => {
  it("aggregates tool usage", async () => {
    const rows = await runQuery<{ tool_name: string; uses: number }>(db, "stats", filterParams());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tool_name).toBeTruthy();
      expect(row.uses).toBeGreaterThan(0);
    }
  });

  it("sorts by uses descending", async () => {
    const rows = await runQuery<{ uses: number }>(db, "stats", filterParams());
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]?.uses).toBeGreaterThanOrEqual(rows[i]?.uses as number);
    }
  });

  it("includes aggregate totals", async () => {
    const rows = await runQuery<{ total_sessions: number; total_tool_uses: number }>(
      db,
      "stats",
      filterParams(),
    );
    expect(rows[0]?.total_sessions).toBeGreaterThan(0);
    expect(rows[0]?.total_tool_uses).toBeGreaterThan(0);
  });

  it("includes non-zero error_rate_pct for tools with errors", async () => {
    const rows = await runQuery<{
      tool_name: string;
      errors: number;
      error_rate_pct: number;
    }>(db, "stats", filterParams());
    const withErrors = rows.filter((r) => r.errors > 0);
    expect(withErrors.length).toBeGreaterThan(0);
    for (const row of withErrors) {
      expect(row.error_rate_pct).toBeGreaterThan(0);
    }
  });
});

describe("errors", () => {
  it("returns error rows", async () => {
    const rows = await runQuery<{ error_content: string; tool_name: string; session_id: string }>(
      db,
      "errors",
      queryParams({ error_type: null }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.error_content).toBeTruthy();
      expect(row.tool_name).toBeTruthy();
      expect(row.session_id).toBe("tools-session");
    }
  });

  it("classifies rejection and failure error types", async () => {
    const rows = await runQuery<{ error_type: string }>(
      db,
      "errors",
      queryParams({ error_type: null }),
    );
    const types = rows.map((r) => r.error_type);
    expect(types).toContain("rejection");
    expect(types).toContain("failure");
  });

  it("filters by error_type", async () => {
    const rows = await runQuery<{ error_type: string }>(
      db,
      "errors",
      queryParams({ error_type: "rejection" }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.error_type).toBe("rejection");
    }
  });
});

describe("incremental refresh", () => {
  it("produces no duplicates on repeated indexing", async () => {
    const before = await runQuery(db, "digest", digestParams({ limit: "100" }));

    await ensureIndex(db, fixturesDir);

    const after = await runQuery(db, "digest", digestParams({ limit: "100" }));

    expect(after).toEqual(before);
  });
});

describe("malformed JSONL", () => {
  it("imports valid messages from files with invalid lines", async () => {
    const rows = await runQuery<{ user_messages: number; assistant_messages: number }>(
      db,
      "digest",
      digestParams({ session_id: "malformed-session" }),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.user_messages)).toBe(1);
    expect(Number(rows[0]?.assistant_messages)).toBe(1);
  });
});
