import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";
import { type Database, dirExists, ensureIndex, getDb, rebuildViews, runQuery } from "./db";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");
const resourcesDir = path.join(import.meta.dirname, "..", "resources");
const plansFixtureDir = path.join(import.meta.dirname, "..", "fixtures", "plans");

async function loadExtensions(database: Database) {
  await database.run(await Bun.file(path.join(resourcesDir, "extensions.sql")).text());
}

function filterParams(overrides: Record<string, string | null> = {}) {
  return { after_date: null, before_date: null, project: null, host: null, ...overrides };
}

function queryParams(overrides: Record<string, string | null> = {}) {
  return filterParams({ limit: "20", ...overrides });
}

let db: Database;
let tmpDir: string;
let importsDir: string;

// The first `INSTALL ... FROM community` downloads the markdown/yaml extensions over
// the network, which can exceed the default per-test timeout on a cold CI runner.
// Warm the shared extension cache once so the per-test LOAD reads from disk.
beforeAll(async () => {
  const warmDir = mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "session-warm-"));
  const warm = await getDb(warmDir);
  try {
    await loadExtensions(warm);
  } finally {
    warm.close();
    await rm(warmDir, { recursive: true, force: true });
  }
}, 120_000);

async function importFixtureHost(label: string, opts: { source?: string } = {}) {
  const projects = path.join(importsDir, label, "projects");
  mkdirSync(projects, { recursive: true });
  await $`cp -R ${fixturesDir}/. ${projects}`.quiet();
  await Bun.write(
    path.join(importsDir, label, "manifest.json"),
    `${JSON.stringify({
      host: label,
      source: opts.source ?? `${label}:.claude/projects/`,
      imported_at: "2026-01-01T00:00:00Z",
      policy: { block_egress: true },
    })}\n`,
  );
}

async function reindex() {
  await ensureIndex(db, { projectsDir: fixturesDir, dataDir: tmpDir, importsDir, force: true });
}

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "session-test-"));
  importsDir = path.join(tmpDir, "imports");
  mkdirSync(importsDir, { recursive: true });
  db = await getDb(tmpDir);
  await ensureIndex(db, { projectsDir: fixturesDir, dataDir: tmpDir, importsDir });
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
    await ensureIndex(db, { projectsDir: fixturesDir, dataDir: tmpDir, importsDir });
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

describe("type drift across imports", () => {
  it("absorbs heterogeneous nested shapes via the `data` JSON column", async () => {
    const drifted = JSON.stringify({
      type: "assistant",
      sessionId: "drift-session",
      cwd: "/Users/test/project",
      timestamp: "2024-01-15T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "drifted" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_sequence: { nested: "object" },
      },
    });
    await db.run(
      `INSERT INTO raw (session_id, type, project_path, timestamp, data)
                  VALUES ('drift-session', 'assistant', '/Users/test/project',
                          '2024-01-15T10:00:00'::TIMESTAMP, $line::JSON)`,
      {
        line: drifted,
      },
    );
    await db.run("DELETE FROM meta");

    await ensureIndex(db, { projectsDir: fixturesDir, dataDir: tmpDir, importsDir, force: true });

    const [typeRow] = await db.query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'raw' AND column_name = 'data'",
    );
    expect(typeRow?.data_type).toBe("JSON");

    const rows = await db.query<{ session_id: string }>(
      "SELECT session_id FROM sessions ORDER BY session_id",
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("discovery", () => {
  it("returns column metadata via the schema query", async () => {
    const rows = await runQuery<{ table_name: string; column_name: string }>(db, "schema");
    const tables = new Set(rows.map((r) => r.table_name));
    expect(tables.has("raw")).toBe(true);
    expect(tables.has("messages")).toBe(true);
    expect(tables.has("content_items")).toBe(true);
    expect(rows.some((r) => r.table_name === "raw" && r.column_name === "data")).toBe(true);
  });

  it("samples JSON keys from raw.data via the keys query", async () => {
    const rows = await runQuery<{ key: string; occurrences: number }>(db, "keys");
    expect(rows.length).toBeGreaterThan(0);
    const keys = new Set(rows.map((r) => r.key));
    expect(keys.has("sessionId")).toBe(true);
    expect(keys.has("type")).toBe(true);
    expect(keys.has("message")).toBe(true);
  });

  it("describes messages with the expected pinned columns", async () => {
    const rows = await db.query<{ column_name: string }>("DESCRIBE messages");
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "session_id",
        "type",
        "project_path",
        "git_branch",
        "is_meta",
        "is_sidechain",
        "duration_ms",
        "timestamp",
        "input_tokens",
        "output_tokens",
        "source_file",
        "source_line",
        "data",
        "content_text",
        "summary",
      ]),
    );
  });
});

describe("text_content view", () => {
  it("excludes tool_use and tool_result content items", async () => {
    const rows = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM text_content WHERE raw_text ILIKE '%tool_use%' OR raw_text ILIKE '%tool_result%'",
    );
    const toolRows = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM content_items WHERE type IN ('tool_use', 'tool_result')",
    );
    expect(toolRows[0]!.n).toBeGreaterThan(0n);
    expect(rows[0]!.n).toBe(0n);
  });

  it("filters out empty text items", async () => {
    const rows = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM text_content WHERE raw_text IS NULL OR length(trim(raw_text)) = 0",
    );
    expect(rows[0]!.n).toBe(0n);
  });

  it("populates role from the parent message", async () => {
    const rows = await db.query<{ role: string }>(
      "SELECT DISTINCT role FROM text_content ORDER BY role",
    );
    expect(rows.map((r) => r.role)).toEqual(["assistant", "user"]);
  });

  it("populates model on assistant rows and leaves it null on user rows", async () => {
    const assistant = await db.query<{ model: string | null }>(
      "SELECT model FROM text_content WHERE role = 'assistant' AND session_id = 'trope-session' LIMIT 1",
    );
    expect(assistant[0]?.model).toContain("claude");

    const user = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM text_content WHERE role = 'user' AND model IS NOT NULL",
    );
    expect(user[0]!.n).toBe(0n);
  });

  it("strips fenced code blocks from text but preserves raw_text", async () => {
    const rows = await db.query<{ text: string; raw_text: string }>(
      "SELECT text, raw_text FROM text_content WHERE session_id = 'trope-session' AND raw_text ILIKE '%```%' LIMIT 1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raw_text).toContain("```");
    expect(rows[0]!.text).not.toContain("```");
    expect(rows[0]!.text).not.toContain("function authenticate");
  });

  it("strips inline backtick code from text", async () => {
    const rows = await db.query<{ text: string; raw_text: string }>(
      "SELECT text, raw_text FROM text_content WHERE session_id = 'trope-session' AND raw_text ILIKE '%`authenticate()`%' LIMIT 1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raw_text).toContain("`authenticate()`");
    expect(rows[0]!.text).not.toContain("`authenticate()`");
    expect(rows[0]!.text).not.toContain("authenticate()");
  });

  it("retains source_file and source_line for traceability", async () => {
    const rows = await db.query<{ source_file: string; source_line: bigint }>(
      "SELECT source_file, source_line FROM text_content WHERE session_id = 'trope-session' LIMIT 1",
    );
    expect(rows[0]!.source_file).toContain("trope.jsonl");
    expect(Number(rows[0]!.source_line)).toBeGreaterThan(0);
  });
});

describe("text-export query", () => {
  function exportParams(overrides: Record<string, string | null> = {}) {
    return {
      role: null,
      model: null,
      after_date: null,
      before_date: null,
      project: null,
      min_chars: null,
      host: null,
      ...overrides,
    };
  }

  it("returns rows filtered by role", async () => {
    const rows = await runQuery<{ role: string }>(
      db,
      "text-export",
      exportParams({ role: "user" }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.role).toBe("user");
  });

  it("filters by model glob", async () => {
    const rows = await runQuery<{ model: string }>(
      db,
      "text-export",
      exportParams({ model: "claude-opus-*" }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.model).toContain("opus");
  });

  it("filters by min_chars on cleaned text", async () => {
    const rows = await runQuery<{ text: string }>(
      db,
      "text-export",
      exportParams({ min_chars: "200" }),
    );
    for (const row of rows) expect(row.text.length).toBeGreaterThanOrEqual(200);
  });
});

describe("phrase-lift query", () => {
  function liftParams(overrides: Record<string, string | null> = {}) {
    return {
      phrase: "reaching for",
      after_date: null,
      before_date: null,
      host: null,
      ...overrides,
    };
  }

  it("counts phrase occurrences per role and model", async () => {
    const rows = await runQuery<{
      role: string;
      model: string | null;
      phrase_count: bigint;
    }>(db, "phrase-lift", liftParams());

    const assistant = rows.find((r) => r.role === "assistant" && r.model?.includes("opus"));
    expect(assistant).toBeDefined();
    expect(Number(assistant!.phrase_count)).toBeGreaterThanOrEqual(3);

    const user = rows.find((r) => r.role === "user");
    expect(user).toBeDefined();
    expect(Number(user!.phrase_count)).toBe(0);
  });

  it("is case-insensitive", async () => {
    const lower = await runQuery<{ phrase_count: bigint }>(
      db,
      "phrase-lift",
      liftParams({ phrase: "reaching for" }),
    );
    const upper = await runQuery<{ phrase_count: bigint }>(
      db,
      "phrase-lift",
      liftParams({ phrase: "REACHING FOR" }),
    );
    const sum = (rows: { phrase_count: bigint }[]) =>
      rows.reduce((acc, r) => acc + Number(r.phrase_count), 0);
    expect(sum(lower)).toBe(sum(upper));
    expect(sum(lower)).toBeGreaterThan(0);
  });

  it("computes per_1m_chars for rows with phrase occurrences", async () => {
    const rows = await runQuery<{
      role: string;
      model: string | null;
      per_1m_chars: number | null;
    }>(db, "phrase-lift", liftParams());
    const assistant = rows.find((r) => r.role === "assistant" && r.model?.includes("opus"));
    expect(assistant!.per_1m_chars).not.toBeNull();
    expect(assistant!.per_1m_chars!).toBeGreaterThan(0);
  });
});

describe("model-summary query", () => {
  it("aggregates per-model counts over assistant text", async () => {
    const rows = await runQuery<{
      model: string;
      messages: bigint;
      total_chars: bigint;
    }>(db, "model-summary", { after_date: null, before_date: null, project: null, host: null });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.model).toBeTruthy();
      expect(Number(row.messages)).toBeGreaterThan(0);
      expect(Number(row.total_chars)).toBeGreaterThan(0);
    }
  });
});

describe("cross-machine history", () => {
  it("tags imported rows with the host across sessions, messages, and content_items", async () => {
    await importFixtureHost("work");
    await reindex();

    for (const tbl of ["sessions", "messages", "content_items"]) {
      const rows = await db.query<{ host: string }>(
        `SELECT DISTINCT host FROM ${tbl} ORDER BY host`,
      );
      expect(rows.map((r) => r.host)).toEqual(["local", "work"]);
    }
  });

  it("scopes to a host with host= and spans all hosts without it", async () => {
    await importFixtureHost("work");
    await reindex();

    const scoped = await runQuery<{ host: string }>(
      db,
      "search",
      queryParams({ host: "work", query: "error" }),
    );
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((r) => r.host === "work")).toBe(true);

    const spanned = await runQuery<{ host: string }>(db, "search", queryParams({ query: "error" }));
    expect(new Set(spanned.map((r) => r.host))).toEqual(new Set(["local", "work"]));

    const scopedStats = await runQuery<{ total_sessions: number }>(
      db,
      "stats",
      filterParams({ host: "work" }),
    );
    const allStats = await runQuery<{ total_sessions: number }>(db, "stats", filterParams());
    expect(Number(allStats[0]?.total_sessions)).toBe(Number(scopedStats[0]?.total_sessions) * 2);
  });

  it("indexes a host whose files predate the local import (per-host watermark)", async () => {
    // Push local's watermark past the imported files so they "predate" the local
    // import. Only a per-host watermark (epoch for a new host) lets archive index;
    // a shared watermark would skip its now-older files.
    await db.run("UPDATE meta SET last_import = '2099-01-01'::TIMESTAMP WHERE host = 'local'");
    await importFixtureHost("archive");
    await reindex();

    const [row] = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM sessions WHERE host = 'archive'",
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });

  it("forget removes a host's rows and synced files", async () => {
    await importFixtureHost("gone");
    await reindex();
    const [before] = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'gone'",
    );
    expect(Number(before?.n)).toBeGreaterThan(0);

    await db.run("DELETE FROM raw WHERE host = $host", { host: "gone" });
    await db.run("DELETE FROM meta WHERE host = $host", { host: "gone" });
    await rebuildViews(db);
    await rm(path.join(importsDir, "gone"), { recursive: true, force: true });

    const [after] = await db.query<{ n: bigint }>(
      "SELECT COUNT(*) AS n FROM raw WHERE host = 'gone'",
    );
    expect(Number(after?.n)).toBe(0);
    const sessions = await db.query<{ host: string }>(
      "SELECT DISTINCT host FROM sessions ORDER BY host",
    );
    expect(sessions.map((r) => r.host)).toEqual(["local"]);
    expect(dirExists(path.join(importsDir, "gone"))).toBe(false);
  });

  it("keeps the same session distinct across hosts without merging or dropping", async () => {
    await importFixtureHost("alpha");
    await importFixtureHost("beta");
    await reindex();

    const hosts = await db.query<{ host: string }>(
      "SELECT host FROM sessions WHERE session_id = 'basic-session' ORDER BY host",
    );
    expect(hosts.map((r) => r.host)).toEqual(["alpha", "beta", "local"]);

    const counts = await db.query<{ host: string; n: bigint }>(
      "SELECT host, COUNT(*) AS n FROM sessions GROUP BY host ORDER BY host",
    );
    expect(counts.map((r) => r.host)).toEqual(["alpha", "beta", "local"]);
    const distinct = new Set(counts.map((r) => Number(r.n)));
    expect(distinct.size).toBe(1);
    expect([...distinct][0]).toBeGreaterThan(0);
  });
});

describe("lossless ingestion", () => {
  it("ingests non-chat record types into raw", async () => {
    const rows = await db.query<{ type: string }>("SELECT DISTINCT type FROM raw ORDER BY type");
    const types = rows.map((r) => r.type);
    for (const t of ["attachment", "system", "permission-mode", "queue-operation"]) {
      expect(types).toContain(t);
    }
  });

  it("exposes the full record taxonomy via the records view", async () => {
    const rows = await db.query<{ kind: string; n: bigint }>(
      "SELECT kind, COUNT(*) AS n FROM records GROUP BY kind",
    );
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds).toContain("attachment:hook_success");
    expect(kinds).toContain("system:compact_boundary");
    expect(kinds).toContain("permission-mode");
  });
});

describe("hook_events", () => {
  it("parses a deny decision and reason from the stdout JSON of a hook_success", async () => {
    const [row] = await db.query<{
      decision: string;
      reason: string;
      command: string;
      blocked: boolean;
    }>(
      "SELECT decision, reason, command, blocked FROM hook_events WHERE tool_use_id = 'hk-write-1' AND kind = 'hook_success'",
    );
    expect(row?.decision).toBe("deny");
    expect(row?.reason).toContain("numbered sequences");
    expect(row?.command).toContain("numbering.ts");
    expect(row?.blocked).toBe(true);
  });

  it("unwraps the message from a hook_blocking_error", async () => {
    const [row] = await db.query<{ reason: string; blocked: boolean }>(
      "SELECT reason, blocked FROM hook_events WHERE kind = 'hook_blocking_error'",
    );
    expect(row?.reason).toBe("Biome check failed. Auto-fix was attempted but issues remain.");
    expect(row?.blocked).toBe(true);
  });

  it("classifies an ask decision as a non-blocking interruption", async () => {
    const rows = await db.query<{ decision: string }>(
      "SELECT decision FROM hook_events WHERE command LIKE '%check-tropes%'",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.decision).toBe("ask");
  });
});

describe("hook_blocks view", () => {
  it("surfaces deny, ask, and block decisions", async () => {
    const rows = await db.query<{ decision: string }>("SELECT decision FROM hook_blocks");
    const decisions = new Set(rows.map((r) => r.decision));
    expect(decisions).toContain("deny");
    expect(decisions).toContain("ask");
    expect(decisions).toContain("block");
  });
});

describe("hooks query", () => {
  it("aggregates runs, blocks, and asks per hook", async () => {
    const rows = await runQuery<{ hook: string; runs: bigint; blocks: bigint; asks: bigint }>(
      db,
      "hooks",
      filterParams({ event: null, hook: null }),
    );
    const tropes = rows.find((r) => r.hook.includes("check-tropes"));
    expect(tropes).toBeDefined();
    expect(Number(tropes?.asks)).toBe(2);
    const numbering = rows.find((r) => r.hook.includes("numbering.ts write"));
    expect(Number(numbering?.blocks)).toBe(1);
  });

  it("filters by hook glob", async () => {
    const rows = await runQuery<{ hook: string }>(
      db,
      "hooks",
      filterParams({ event: null, hook: "*check-tropes*" }),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.hook).toContain("check-tropes");
  });
});

describe("hook-blocks query", () => {
  it("groups by signature and counts repeat storms within a session", async () => {
    const rows = await runQuery<{
      hook: string;
      blocks: bigint;
      asks: bigint;
      storm_sessions: bigint;
      max_burst: bigint;
    }>(db, "hook-blocks", filterParams({ hook: null }));
    const emdash = rows.find((r) => r.hook.includes("check-tropes"));
    expect(Number(emdash?.blocks)).toBe(2);
    expect(Number(emdash?.asks)).toBe(2);
    // Both em-dash asks land in one session, so it is a storm of burst 2.
    expect(Number(emdash?.storm_sessions)).toBe(1);
    expect(Number(emdash?.max_burst)).toBe(2);
  });
});

describe("fields discovery query", () => {
  it("enumerates the keys of an attachment kind via schema inference", async () => {
    const rows = await runQuery<{ field: string; json_type: string }>(
      db,
      "fields",
      filterParams({ kind: "attachment:hook_success", path: "$.attachment" }),
    );
    const fields = new Set(rows.map((r) => r.field));
    for (const f of ["command", "exitCode", "stdout", "hookEvent"]) {
      expect(fields).toContain(f);
    }
  });
});

describe("activity query", () => {
  it("counts human and automated interaction signals", async () => {
    const rows = await runQuery<{ signal: string; count: bigint }>(db, "activity", filterParams());
    const bySignal = new Map(rows.map((r) => [r.signal, Number(r.count)]));
    expect(bySignal.get("interruptions")).toBe(1);
    expect(bySignal.get("auto-continuations")).toBe(1);
    expect(bySignal.get("compactions")).toBe(1);
    expect(bySignal.get("mode: auto")).toBe(1);
    expect(bySignal.get("mode: plan")).toBe(1);
  });
});

describe("diagnostics view and query", () => {
  it("unnests one row per diagnostic with severity, source, and code", async () => {
    const rows = await db.query<{ severity: string; source: string; code: string; file: string }>(
      "SELECT severity, source, code, file FROM diagnostics ORDER BY severity",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.severity).toBe("Error");
    expect(rows[0]?.source).toBe("ty");
    expect(rows[0]?.code).toBe("unresolved-import");
    expect(rows[0]?.file).toBe("/Users/test/project/app.py");
  });

  it("groups recurring diagnostics by code", async () => {
    const rows = await runQuery<{ code: string; occurrences: bigint; files: bigint }>(
      db,
      "diagnostics",
      filterParams(),
    );
    const imp = rows.find((r) => r.code === "unresolved-import");
    expect(Number(imp?.occurrences)).toBe(1);
    expect(Number(imp?.files)).toBe(1);
  });
});

describe("file_operations view and files query", () => {
  it("captures file edits with the attributed skill", async () => {
    const [row] = await db.query<{ operation: string; attribution_skill: string }>(
      "SELECT operation, attribution_skill FROM file_operations WHERE file_path = '/Users/test/project/doc.md' AND operation = 'Write'",
    );
    expect(row?.operation).toBe("Write");
    expect(row?.attribution_skill).toBe("writing:writing");
  });

  it("ranks files by edits", async () => {
    const rows = await runQuery<{ file_path: string; edits: bigint }>(
      db,
      "files",
      filterParams({ limit: "20" }),
    );
    const doc = rows.find((r) => r.file_path === "/Users/test/project/doc.md");
    expect(Number(doc?.edits)).toBeGreaterThanOrEqual(1);
  });
});

describe("pr_links view", () => {
  it("links a session to the PR it produced", async () => {
    const [row] = await db.query<{ pr_number: bigint; repository: string; session_id: string }>(
      "SELECT pr_number, repository, session_id FROM pr_links WHERE session_id = 'hooks-session'",
    );
    expect(Number(row?.pr_number)).toBe(42);
    expect(row?.repository).toBe("test/project");
  });
});

describe("attribution and skill-activity query", () => {
  it("exposes attribution on tool_calls", async () => {
    const [row] = await db.query<{ attribution_skill: string }>(
      "SELECT attribution_skill FROM tool_calls WHERE tool_id = 'hk-write-1'",
    );
    expect(row?.attribution_skill).toBe("writing:writing");
  });

  it("aggregates attributed work and tokens per skill", async () => {
    const rows = await runQuery<{ skill: string; assistant_turns: bigint }>(
      db,
      "skill-activity",
      filterParams(),
    );
    const writing = rows.find((r) => r.skill === "writing:writing");
    expect(Number(writing?.assistant_turns)).toBeGreaterThanOrEqual(1);
  });
});

describe("plan_calls view and plans query", () => {
  it("classifies a redirected plan as outcome=redirected with plan_seq=1", async () => {
    const rows = await db.query<{
      session_id: string;
      outcome: string;
      plan_seq: bigint;
      plan_chars: bigint;
      plan_file: string;
    }>(
      "SELECT session_id, outcome, plan_seq, plan_chars, plan_file FROM plan_calls WHERE session_id = 'plan-session' ORDER BY plan_seq",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.outcome).toBe("redirected");
    expect(Number(rows[0]?.plan_seq)).toBe(1);
    expect(Number(rows[0]?.plan_chars)).toBeGreaterThan(0);
    expect(rows[0]?.plan_file).toContain("plan-session");
  });

  it("classifies the second plan (after approval) as outcome=approved with plan_seq=2", async () => {
    const rows = await db.query<{ outcome: string; plan_seq: bigint }>(
      "SELECT outcome, plan_seq FROM plan_calls WHERE session_id = 'plan-session' ORDER BY plan_seq",
    );
    expect(rows[1]?.outcome).toBe("approved");
    expect(Number(rows[1]?.plan_seq)).toBe(2);
  });

  it("aggregates plan_sessions with correct counts and replan tier", async () => {
    const [row] = await db.query<{
      plan_count: bigint;
      redirect_count: bigint;
      approved_count: bigint;
    }>(
      "SELECT plan_count, redirect_count, approved_count FROM plan_sessions WHERE session_id = 'plan-session'",
    );
    expect(Number(row?.plan_count)).toBe(2);
    expect(Number(row?.redirect_count)).toBe(1);
    expect(Number(row?.approved_count)).toBe(1);
  });

  it("reports the session via the plans query with replan_tier=replan", async () => {
    const rows = await runQuery<{ session_id: string; replan_tier: string; plan_count: bigint }>(
      db,
      "plans",
      { after_date: null, before_date: null, project: null, host: null, min_plans: null },
    );
    const row = rows.find((r) => r.session_id === "plan-session");
    expect(row).toBeDefined();
    expect(row?.replan_tier).toBe("replan");
    expect(Number(row?.plan_count)).toBe(2);
  });

  it("excludes sessions below min_plans threshold", async () => {
    const rows = await runQuery<{ session_id: string }>(db, "plans", {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "3",
    });
    expect(rows.find((r) => r.session_id === "plan-session")).toBeUndefined();
  });
});

describe("plan-sections query", () => {
  const plansGlob = path.join(plansFixtureDir, "*.md");
  const featurePlan = path.join(plansFixtureDir, "feature-plan.md");

  type Section = {
    session_id: string | null;
    outcome: string | null;
    title: string;
    level: number;
    file_path: string;
  };

  beforeEach(async () => {
    await loadExtensions(db);
  });

  async function insertDiskPlan() {
    // A plan_calls row whose planFilePath points at an on-disk fixture, so its
    // sections join to session context. content_items rebuilds from raw on rebuildViews.
    const assistant = JSON.stringify({
      type: "assistant",
      sessionId: "disk-plan-session",
      cwd: "/Users/test/project",
      timestamp: "2026-02-01T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "disk-plan-1",
            name: "ExitPlanMode",
            input: { plan: "# Feature Plan", planFilePath: featurePlan },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    const result = JSON.stringify({
      type: "user",
      sessionId: "disk-plan-session",
      timestamp: "2026-02-01T10:01:00.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "disk-plan-1",
            content: "User has approved your plan. You can now start coding.",
          },
        ],
      },
    });
    for (const [type, line, ts] of [
      ["assistant", assistant, "2026-02-01T10:00:00"],
      ["user", result, "2026-02-01T10:01:00"],
    ] as const) {
      await db.run(
        `INSERT INTO raw (host, session_id, type, project_path, timestamp, data)
         VALUES ('local', 'disk-plan-session', $type, '/Users/test/project',
                 $ts::TIMESTAMP, $line::JSON)`,
        { type, ts, line },
      );
    }
    await rebuildViews(db);
  }

  it("parses one row per section with level and title", async () => {
    const rows = await runQuery<Section>(db, "plan-sections", { plans_glob: plansGlob });
    const feature = rows.filter((r) => r.file_path === featurePlan);
    expect(feature.map((r) => r.title)).toEqual([
      "Feature Plan",
      "Context",
      "Plan",
      "Queue Sizing",
      "Verification",
    ]);
    expect(feature.find((r) => r.title === "Queue Sizing")?.level).toBe(3);
  });

  it("finds plans whose sections lack a Verification heading", async () => {
    const rows = await runQuery<Section>(db, "plan-sections", { plans_glob: plansGlob });
    const byFile = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!byFile.has(r.file_path)) byFile.set(r.file_path, new Set());
      byFile.get(r.file_path)!.add(r.title);
    }
    const missing = [...byFile.entries()]
      .filter(([, titles]) => !titles.has("Verification"))
      .map(([file]) => file);
    expect(missing).toContain(path.join(plansFixtureDir, "quick-plan.md"));
    expect(missing).not.toContain(featurePlan);
  });

  it("joins sections to the session that produced the plan", async () => {
    await insertDiskPlan();
    const rows = await runQuery<Section>(db, "plan-sections", { plans_glob: plansGlob });

    const feature = rows.filter((r) => r.file_path === featurePlan);
    expect(feature.length).toBeGreaterThan(0);
    for (const r of feature) {
      expect(r.session_id).toBe("disk-plan-session");
      expect(r.outcome).toBe("approved");
    }

    // quick-plan.md has no matching plan_calls row, so the LEFT JOIN leaves it null.
    const quick = rows.filter((r) => r.file_path === path.join(plansFixtureDir, "quick-plan.md"));
    expect(quick.length).toBeGreaterThan(0);
    for (const r of quick) expect(r.session_id).toBeNull();
  });

  it("omits a plan whose planFilePath does not exist on disk (cross-host/deleted)", async () => {
    // The plan-session fixture's planFilePath is /Users/test/.claude/plans/plan-session.md,
    // outside the glob. The LEFT JOIN from sections means that plan yields no section rows.
    const rows = await runQuery<Section>(db, "plan-sections", { plans_glob: plansGlob });
    expect(rows.some((r) => r.session_id === "plan-session")).toBe(false);
  });
});

describe("frontmatter query", () => {
  it("parses name and description from a SKILL.md frontmatter", async () => {
    await loadExtensions(db);
    const skill = path.join(import.meta.dirname, "..", "SKILL.md");
    const rows = await runQuery<{ file_path: string; name: string; description: string }>(
      db,
      "frontmatter",
      { frontmatter_glob: skill },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("claude-code:session");
    expect(rows[0]?.description).toContain("DuckDB index");
  });
});
