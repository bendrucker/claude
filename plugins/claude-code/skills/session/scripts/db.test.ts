import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { type Database, ensureIndex, getDb, runQuery } from "./db";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");

function filterParams(overrides: Record<string, string | null> = {}) {
  return { after_date: null, before_date: null, project: null, ...overrides };
}

function queryParams(overrides: Record<string, string | null> = {}) {
  return filterParams({ limit: "20", ...overrides });
}

let db: Database;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "session-test-"));
  db = await getDb(tmpDir);
  await ensureIndex(db, { projectsDir: fixturesDir, dataDir: tmpDir });
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("sessions view", () => {
  it("returns sessions sorted by start time descending", async () => {
    const rows = await db.query<{ start_time: Date }>(
      "SELECT * FROM sessions ORDER BY start_time DESC",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.start_time >= rows[i]!.start_time).toBe(true);
    }
  });

  it("includes summary when present", async () => {
    const rows = await db.query<{ summary: string }>(
      "SELECT summary FROM sessions WHERE session_id = 'summary-session'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe(
      "Fixed database connection pooling issue causing timeouts under load",
    );
  });

  it("includes project metadata", async () => {
    const rows = await db.query<{ project_path: string; git_branch: string }>(
      "SELECT project_path, git_branch FROM sessions WHERE session_id = 'basic-session'",
    );
    expect(rows[0]?.project_path).toBe("/Users/test/project");
    expect(rows[0]?.git_branch).toBe("main");
  });
});

describe("search", () => {
  it("finds sessions matching keyword", async () => {
    const rows = await runQuery(db, "search", { query: "error", ...queryParams({ limit: "10" }) });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", async () => {
    const rows = await runQuery(db, "search", {
      ...queryParams({ limit: "10" }),
      query: "zzzznonexistentzzzz",
    });
    expect(rows).toHaveLength(0);
  });

  it("filters by project", async () => {
    const rows = await runQuery<{ project_path: string }>(db, "search", {
      ...queryParams({ project: "webapp", limit: "10" }),
      query: "authentication",
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
      ...queryParams({ limit: "10" }),
      query: "database connection pooling",
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

describe("permission_requests", () => {
  it("returns rejected tool calls with tool details", async () => {
    const rows = await db.query<{
      tool_name: string;
      tool_id: string;
      session_id: string;
    }>("SELECT * FROM permission_requests");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_name).toBe("Bash");
    expect(rows[0]?.tool_id).toBe("tool-1");
    expect(rows[0]?.session_id).toBe("tools-session");
  });
});

describe("sandbox_bypasses", () => {
  it("returns sandbox bypass calls", async () => {
    const rows = await db.query<{
      command: string;
      description: string;
      tool_id: string;
      session_id: string;
    }>("SELECT * FROM sandbox_bypasses");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toContain("osascript");
    expect(rows[0]?.description).toBe("Query Things via JXA");
    expect(rows[0]?.session_id).toBe("tools-session");
  });

  it("links to the prior failed sandboxed call", async () => {
    const rows = await db.query<{
      retried_tool_id: string | null;
      retried_error: string | null;
    }>("SELECT retried_tool_id, retried_error FROM sandbox_bypasses");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.retried_tool_id).toBe("tool-4a");
    expect(rows[0]?.retried_error).toContain("Connection Invalid");
  });
});

describe("permissions query", () => {
  it("returns permission requests with filters", async () => {
    const rows = await runQuery<{ tool_name: string; target: string }>(
      db,
      "permissions",
      queryParams(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_name).toBe("Bash");
    expect(rows[0]?.target).toContain("npm test");
  });

  it("filters by project", async () => {
    const rows = await runQuery<{ tool_name: string }>(
      db,
      "permissions",
      queryParams({ project: "nonexistent" }),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("sandbox query", () => {
  it("returns sandbox bypasses with retry detection", async () => {
    const rows = await runQuery<{ command: string; is_retry: boolean; prior_error: string | null }>(
      db,
      "sandbox",
      queryParams(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toContain("osascript");
    expect(rows[0]?.is_retry).toBe(true);
    expect(rows[0]?.prior_error).toContain("Connection Invalid");
  });
});

describe("incremental refresh", () => {
  it("produces no duplicates on repeated indexing", async () => {
    const before = await db.query<{ session_id: string }>(
      "SELECT * FROM sessions ORDER BY session_id",
    );
    await ensureIndex(db, { projectsDir: fixturesDir, dataDir: tmpDir });
    const after = await db.query<{ session_id: string }>(
      "SELECT * FROM sessions ORDER BY session_id",
    );
    expect(after).toEqual(before);
  });
});

describe("sessions without message container/type/id", () => {
  it("indexes alongside sessions that have them", async () => {
    const rows = await db.query<{ session_id: string; project_path: string }>(
      "SELECT session_id, project_path FROM sessions WHERE session_id = 'no-container-session'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_path).toBe("/Users/test/project");
  });
});

describe("malformed JSONL", () => {
  it("imports valid messages from files with invalid lines", async () => {
    const rows = await db.query<{ user_messages: number; assistant_messages: number }>(
      "SELECT user_messages, assistant_messages FROM sessions WHERE session_id = 'malformed-session'",
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.user_messages)).toBe(1);
    expect(Number(rows[0]?.assistant_messages)).toBe(1);
  });
});
