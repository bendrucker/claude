import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { z } from "zod";
import {
  compactDatabase,
  type Database,
  dirExists,
  ensureIndex,
  ensureSchema,
  getDb,
  invalidateDerived,
  rebuildViews,
  runQuery,
} from "./db";
import { FALLBACK_PATH, renderMap, schemaMap, SurfaceColumns, SURFACES } from "./schema";

async function backdate(target: string) {
  // Bun's shell builtin touch lacks -t, so use the system binary.
  await $`/usr/bin/touch -t 200001010000 ${target}`.quiet();
}

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
  const warmDir = mkdtempSync(path.join(tmpdir(), "session-warm-"));
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
  await ensureIndex(db, { projectsDir: fixturesDir, importsDir });
}

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "session-test-"));
  importsDir = path.join(tmpDir, "imports");
  mkdirSync(importsDir, { recursive: true });
  db = await getDb(tmpDir);
  await reindex();
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("sessions view", () => {
  it("returns sessions sorted by start time descending", async () => {
    const rows = await db.query(
      "SELECT * FROM sessions ORDER BY start_time DESC",
      z.object({ start_time: z.date() }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.start_time >= rows[i]!.start_time).toBe(true);
    }
  });

  it("prefers a custom title over the generated ones, taking the last one written", async () => {
    const rows = await db.query(
      "SELECT label, label_source FROM sessions WHERE session_id = 'labeled-session'",
      z.object({ label: z.string(), label_source: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("db-pool-sizing-final");
    expect(rows[0]?.label_source).toBe("custom-title");
  });

  it("falls back to the generated title, and leaves an untitled session null", async () => {
    const rows = await db.query(
      "SELECT session_id, label FROM sessions WHERE session_id IN ('ai-titled-session', 'unlabeled-session') ORDER BY session_id",
      z.object({ session_id: z.string(), label: z.string().nullable() }),
    );
    expect(rows).toEqual([
      { session_id: "ai-titled-session", label: "Retry budget for the ingest worker" },
      { session_id: "unlabeled-session", label: null },
    ]);
  });

  it("includes project metadata", async () => {
    const rows = await db.query(
      "SELECT project_path, git_branch FROM sessions WHERE session_id = 'basic-session'",
      z.object({ project_path: z.string(), git_branch: z.string() }),
    );
    expect(rows[0]?.project_path).toBe("/Users/test/project");
    expect(rows[0]?.git_branch).toBe("main");
  });
});

describe("search", () => {
  it("finds sessions matching keyword", async () => {
    const rows = await runQuery(db, "search", z.unknown(), {
      query: "error",
      ...queryParams({ limit: "10" }),
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", async () => {
    const rows = await runQuery(db, "search", z.unknown(), {
      ...queryParams({ limit: "10" }),
      query: "zzzznonexistentzzzz",
    });
    expect(rows).toHaveLength(0);
  });

  it("filters by project", async () => {
    const rows = await runQuery(db, "search", z.object({ project_path: z.string() }), {
      ...queryParams({ project: "webapp", limit: "10" }),
      query: "authentication",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.project_path).toContain("webapp");
    }
  });

  it("respects limit", async () => {
    const rows = await runQuery(db, "search", z.unknown(), {
      query: "the",
      ...queryParams({ limit: "2" }),
    });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("matches a session label that appears nowhere in the transcript", async () => {
    const rows = await runQuery(db, "search", z.object({ session_id: z.string() }), {
      ...queryParams({ limit: "10" }),
      query: "db-pool-sizing-final",
    });
    expect(rows.map((r) => r.session_id)).toEqual(["labeled-session"]);
  });
});

describe("stats", () => {
  it("aggregates tool usage", async () => {
    const rows = await runQuery(
      db,
      "stats",
      z.object({ tool_name: z.string(), uses: z.bigint() }),
      filterParams(),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tool_name).toBeTruthy();
      expect(row.uses).toBeGreaterThan(0);
    }
  });

  it("sorts by uses descending", async () => {
    const rows = await runQuery(db, "stats", z.object({ uses: z.bigint() }), filterParams());
    const uses = rows.map((row) => Number(row.uses));
    expect(uses).toEqual(uses.toSorted((a, b) => b - a));
  });

  it("includes aggregate totals", async () => {
    const rows = await runQuery(
      db,
      "stats",
      z.object({ total_sessions: z.bigint(), total_tool_uses: z.bigint() }),
      filterParams(),
    );
    expect(rows[0]?.total_sessions).toBeGreaterThan(0);
    expect(rows[0]?.total_tool_uses).toBeGreaterThan(0);
  });

  it("includes non-zero error_rate_pct for tools with errors", async () => {
    const rows = await runQuery(
      db,
      "stats",
      z.object({ tool_name: z.string(), errors: z.bigint(), error_rate_pct: z.number() }),
      filterParams(),
    );
    const withErrors = rows.filter((r) => r.errors > 0);
    expect(withErrors.length).toBeGreaterThan(0);
    for (const row of withErrors) {
      expect(row.error_rate_pct).toBeGreaterThan(0);
    }
  });
});

describe("errors", () => {
  it("returns error rows", async () => {
    const rows = await runQuery(
      db,
      "errors",
      z.object({ error_content: z.string(), tool_name: z.string(), session_id: z.string() }),
      queryParams(),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.error_content).toBeTruthy();
      expect(row.tool_name).toBeTruthy();
      expect(row.session_id).toBeTruthy();
    }
    expect(rows.some((r) => r.session_id === "tools-session")).toBe(true);
  });

  it("reports failures only, leaving every denial to the permissions query", async () => {
    const rows = await runQuery(
      db,
      "errors",
      z.object({ error_type: z.string(), denial_kind: z.string().nullable() }),
      queryParams({ limit: "100" }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.error_type).toBe("failure");
      expect(row.denial_kind).toBeNull();
    }
  });
});

describe("permission_requests", () => {
  it("reports every denial kind, not just the ones the result string names", async () => {
    const rows = await db.query(
      "SELECT tool_id, denial_kind, kind_source FROM permission_requests WHERE session_id = 'denials-session' ORDER BY tool_id",
      z.object({ tool_id: z.string(), denial_kind: z.string(), kind_source: z.string() }),
    );
    expect(rows).toEqual([
      { tool_id: "deny-tool-1", denial_kind: "user-rejected", kind_source: "field" },
      { tool_id: "deny-tool-2", denial_kind: "permission-rule", kind_source: "field" },
      { tool_id: "deny-tool-3", denial_kind: "automode-blocked", kind_source: "field" },
      { tool_id: "deny-tool-4", denial_kind: "automode-unavailable", kind_source: "field" },
      { tool_id: "deny-tool-5", denial_kind: "user-rejected", kind_source: "result-string" },
    ]);
  });

  it("returns rejected tool calls with tool details", async () => {
    const rows = await db.query(
      "SELECT * FROM permission_requests WHERE session_id = 'tools-session'",
      z.object({ tool_name: z.string(), tool_id: z.string(), session_id: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_name).toBe("Bash");
    expect(rows[0]?.tool_id).toBe("tool-1");
    expect(rows[0]?.session_id).toBe("tools-session");
  });

  it("counts a rejection the harness marked but the result string does not name", async () => {
    const rows = await db.query(
      "SELECT error_type, denial_kind FROM tool_errors WHERE tool_id = 'deny-tool-1'",
      z.object({ error_type: z.string(), denial_kind: z.string() }),
    );
    expect(rows).toEqual([{ error_type: "rejection", denial_kind: "user-rejected" }]);
  });

  it("leaves a permission-rule denial as a failure so hook_denies still recovers it", async () => {
    const rows = await db.query(
      "SELECT error_type, denial_kind FROM tool_errors WHERE tool_id = 'deny-tool-2'",
      z.object({ error_type: z.string(), denial_kind: z.string() }),
    );
    expect(rows).toEqual([{ error_type: "failure", denial_kind: "permission-rule" }]);
  });
});

describe("sandbox_bypasses", () => {
  it("returns sandbox bypass calls", async () => {
    const rows = await db.query(
      "SELECT * FROM sandbox_bypasses",
      z.object({
        command: z.string(),
        description: z.string(),
        tool_id: z.string(),
        session_id: z.string(),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toContain("osascript");
    expect(rows[0]?.description).toBe("Query Things via JXA");
    expect(rows[0]?.session_id).toBe("tools-session");
  });

  it("links to the prior failed sandboxed call", async () => {
    const rows = await db.query(
      "SELECT retried_tool_id, retried_error FROM sandbox_bypasses",
      z.object({ retried_tool_id: z.string().nullable(), retried_error: z.string().nullable() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.retried_tool_id).toBe("tool-4a");
    expect(rows[0]?.retried_error).toContain("Connection Invalid");
  });
});

describe("permissions query", () => {
  it("returns permission requests with filters", async () => {
    const rows = await runQuery(
      db,
      "permissions",
      z.object({ tool_name: z.string(), target: z.string().nullable() }),
      queryParams({ project: "api", limit: "100" }),
    );
    expect(rows.some((r) => r.tool_name === "Bash" && r.target?.includes("npm test"))).toBe(true);
  });

  it("filters to one denial kind", async () => {
    const rows = await runQuery(
      db,
      "permissions",
      z.object({ denial_kind: z.string() }),
      queryParams({ denial_kind: "automode-blocked", limit: "100" }),
    );
    expect(rows.map((r) => r.denial_kind)).toEqual(["automode-blocked"]);
  });

  it("filters by project", async () => {
    const rows = await runQuery(
      db,
      "permissions",
      z.object({ tool_name: z.string() }),
      queryParams({ project: "nonexistent" }),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("sandbox query", () => {
  it("returns sandbox bypasses with retry detection", async () => {
    const rows = await runQuery(
      db,
      "sandbox",
      z.object({ command: z.string(), is_retry: z.boolean(), prior_error: z.string().nullable() }),
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
    const before = await db.query(
      "SELECT * FROM sessions ORDER BY session_id",
      z.object({ session_id: z.string() }),
    );
    await reindex();
    const after = await db.query(
      "SELECT * FROM sessions ORDER BY session_id",
      z.object({ session_id: z.string() }),
    );
    expect(after).toEqual(before);
  });
});

describe("sessions without message container/type/id", () => {
  it("indexes alongside sessions that have them", async () => {
    const rows = await db.query(
      "SELECT session_id, project_path FROM sessions WHERE session_id = 'no-container-session'",
      z.object({ session_id: z.string(), project_path: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_path).toBe("/Users/test/project");
  });
});

describe("malformed JSONL", () => {
  it("imports valid messages from files with invalid lines", async () => {
    const rows = await db.query(
      "SELECT user_messages, assistant_messages FROM sessions WHERE session_id = 'malformed-session'",
      z.object({ user_messages: z.bigint(), assistant_messages: z.bigint() }),
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
    await db.run("DELETE FROM indexed_files");

    await reindex();

    const [typeRow] = await db.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'raw' AND column_name = 'data'",
      z.object({ data_type: z.string() }),
    );
    expect(typeRow?.data_type).toBe("JSON");

    const rows = await db.query(
      "SELECT session_id FROM sessions ORDER BY session_id",
      z.object({ session_id: z.string() }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("discovery", () => {
  it("returns column metadata via the schema query", async () => {
    const rows = await runQuery(
      db,
      "schema",
      z.object({ table_name: z.string(), column_name: z.string() }),
    );
    const tables = new Set(rows.map((r) => r.table_name));
    expect(tables.has("raw")).toBe(true);
    expect(tables.has("messages")).toBe(true);
    expect(tables.has("content_items")).toBe(true);
    expect(rows.some((r) => r.table_name === "raw" && r.column_name === "data")).toBe(true);
  });

  it("samples JSON keys from raw.data via the keys query", async () => {
    const rows = await runQuery(db, "keys", z.object({ key: z.string(), occurrences: z.bigint() }));
    expect(rows.length).toBeGreaterThan(0);
    const keys = new Set(rows.map((r) => r.key));
    expect(keys.has("sessionId")).toBe(true);
    expect(keys.has("type")).toBe(true);
    expect(keys.has("message")).toBe(true);
  });

  it("describes messages with the expected pinned columns", async () => {
    const rows = await db.query("DESCRIBE messages", z.object({ column_name: z.string() }));
    const cols = new Set(rows.map((r) => r.column_name));
    const pinned = [
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
      "prompt_source",
      "interrupted_message_id",
    ];
    expect(pinned.filter((col) => !cols.has(col))).toEqual([]);
    expect(cols.has("summary")).toBe(false);
  });
});

describe("text_content view", () => {
  it("excludes tool_use and tool_result content items", async () => {
    const rows = await db.query(
      "SELECT COUNT(*) AS n FROM text_content WHERE raw_text ILIKE '%tool_use%' OR raw_text ILIKE '%tool_result%'",
      z.object({ n: z.bigint() }),
    );
    const toolRows = await db.query(
      "SELECT COUNT(*) AS n FROM content_items WHERE type IN ('tool_use', 'tool_result')",
      z.object({ n: z.bigint() }),
    );
    expect(toolRows[0]!.n).toBeGreaterThan(0n);
    expect(rows[0]!.n).toBe(0n);
  });

  it("filters out empty text items", async () => {
    const rows = await db.query(
      "SELECT COUNT(*) AS n FROM text_content WHERE raw_text IS NULL OR length(trim(raw_text)) = 0",
      z.object({ n: z.bigint() }),
    );
    expect(rows[0]!.n).toBe(0n);
  });

  it("populates role from the parent message", async () => {
    const rows = await db.query(
      "SELECT DISTINCT role FROM text_content ORDER BY role",
      z.object({ role: z.string() }),
    );
    expect(rows.map((r) => r.role)).toEqual(["assistant", "user"]);
  });

  it("populates model on assistant rows and leaves it null on user rows", async () => {
    const assistant = await db.query(
      "SELECT model FROM text_content WHERE role = 'assistant' AND session_id = 'trope-session' LIMIT 1",
      z.object({ model: z.string().nullable() }),
    );
    expect(assistant[0]?.model).toContain("claude");

    const user = await db.query(
      "SELECT COUNT(*) AS n FROM text_content WHERE role = 'user' AND model IS NOT NULL",
      z.object({ n: z.bigint() }),
    );
    expect(user[0]!.n).toBe(0n);
  });

  it("strips fenced code blocks from text but preserves raw_text", async () => {
    const rows = await db.query(
      "SELECT text, raw_text FROM text_content WHERE session_id = 'trope-session' AND raw_text ILIKE '%```%' LIMIT 1",
      z.object({ text: z.string(), raw_text: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raw_text).toContain("```");
    expect(rows[0]!.text).not.toContain("```");
    expect(rows[0]!.text).not.toContain("function authenticate");
  });

  it("strips inline backtick code from text", async () => {
    const rows = await db.query(
      "SELECT text, raw_text FROM text_content WHERE session_id = 'trope-session' AND raw_text ILIKE '%`authenticate()`%' LIMIT 1",
      z.object({ text: z.string(), raw_text: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raw_text).toContain("`authenticate()`");
    expect(rows[0]!.text).not.toContain("`authenticate()`");
    expect(rows[0]!.text).not.toContain("authenticate()");
  });

  it("retains source_file and source_line for traceability", async () => {
    const rows = await db.query(
      "SELECT source_file, source_line FROM text_content WHERE session_id = 'trope-session' LIMIT 1",
      z.object({ source_file: z.string(), source_line: z.bigint() }),
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
    const rows = await runQuery(
      db,
      "text-export",
      z.object({ role: z.string() }),
      exportParams({ role: "user" }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.role).toBe("user");
  });

  it("filters by model glob", async () => {
    const rows = await runQuery(
      db,
      "text-export",
      z.object({ model: z.string() }),
      exportParams({ model: "claude-opus-*" }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.model).toContain("opus");
  });

  it("filters by min_chars on cleaned text", async () => {
    const rows = await runQuery(
      db,
      "text-export",
      z.object({ text: z.string() }),
      exportParams({ min_chars: "200" }),
    );
    for (const row of rows) expect(row.text.length).toBeGreaterThanOrEqual(200);
  });
});

describe("model-summary query", () => {
  it("aggregates per-model counts over assistant text", async () => {
    const rows = await runQuery(
      db,
      "model-summary",
      z.object({ model: z.string(), messages: z.bigint(), total_chars: z.bigint() }),
      { after_date: null, before_date: null, project: null, host: null },
    );
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
      await backdate(path.join(importsDir, "archive", "projects", rel));
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

    await db.run("DELETE FROM raw WHERE host = $host", { host: "gone" });
    await db.run("DELETE FROM content_items WHERE host = $host", { host: "gone" });
    await db.run("DELETE FROM indexed_files WHERE host = $host", { host: "gone" });
    await db.run("DELETE FROM meta WHERE host = $host", { host: "gone" });
    await rm(path.join(importsDir, "gone"), { recursive: true, force: true });

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
    expect(dirExists(path.join(importsDir, "gone"))).toBe(false);
  });

  // forget marks the derived tables stale before it deletes, which is what makes the
  // removal durable: its own rebuild may not run, and the host's files are already gone,
  // so no later refresh sees a change that would ask for one.
  it("drops a forgotten host from the derived tables after an interrupted forget", async () => {
    await importFixtureHost("gone");
    await reindex();

    await invalidateDerived(db);
    await db.run("DELETE FROM raw WHERE host = $host", { host: "gone" });
    await db.run("DELETE FROM indexed_files WHERE host = $host", { host: "gone" });
    await db.run("DELETE FROM meta WHERE host = $host", { host: "gone" });
    await rm(path.join(importsDir, "gone"), { recursive: true, force: true });

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

describe("lossless ingestion", () => {
  it("ingests non-chat record types into raw", async () => {
    const rows = await db.query(
      "SELECT DISTINCT type FROM raw ORDER BY type",
      z.object({ type: z.string().nullable() }),
    );
    const types = rows.map((r) => r.type);
    for (const t of ["attachment", "system", "permission-mode", "queue-operation"]) {
      expect(types).toContain(t);
    }
  });

  it("exposes the full record taxonomy via the records view", async () => {
    const rows = await db.query(
      "SELECT kind, COUNT(*) AS n FROM records GROUP BY kind",
      z.object({ kind: z.string().nullable(), n: z.bigint() }),
    );
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds).toContain("attachment:hook_success");
    expect(kinds).toContain("system:compact_boundary");
    expect(kinds).toContain("permission-mode");
  });
});

describe("hook_events", () => {
  it("parses a deny decision and reason from the stdout JSON of a hook_success", async () => {
    const [row] = await db.query(
      "SELECT decision, reason, command, blocked FROM hook_events WHERE tool_use_id = 'hk-write-1' AND kind = 'hook_success'",
      z.object({
        decision: z.string(),
        reason: z.string(),
        command: z.string(),
        blocked: z.boolean(),
      }),
    );
    expect(row?.decision).toBe("deny");
    expect(row?.reason).toContain("numbered sequences");
    expect(row?.command).toContain("numbering.ts");
    expect(row?.blocked).toBe(true);
  });

  it("unwraps the message from a hook_blocking_error", async () => {
    const [row] = await db.query(
      "SELECT reason, blocked FROM hook_events WHERE kind = 'hook_blocking_error' AND session_id = 'hooks-session'",
      z.object({ reason: z.string(), blocked: z.boolean() }),
    );
    expect(row?.reason).toBe("Biome check failed. Auto-fix was attempted but issues remain.");
    expect(row?.blocked).toBe(true);
  });

  it("classifies an ask decision as a non-blocking interruption", async () => {
    const rows = await db.query(
      "SELECT decision FROM hook_events WHERE command LIKE '%check-tropes%'",
      z.object({ decision: z.string() }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.decision).toBe("ask");
  });
});

describe("hook_blocks view", () => {
  it("surfaces deny, ask, and block decisions", async () => {
    const rows = await db.query(
      "SELECT decision FROM hook_blocks",
      z.object({ decision: z.string() }),
    );
    const decisions = new Set(rows.map((r) => r.decision));
    expect(decisions).toContain("deny");
    expect(decisions).toContain("ask");
    expect(decisions).toContain("block");
  });
});

const Latency = z.object({
  hook: z.string(),
  p95_ms: z.bigint().nullable(),
  ambient_p50_ms: z.bigint().nullable(),
  excess_p95_ms: z.bigint().nullable(),
});
type Latency = z.infer<typeof Latency>;

describe("hooks query", () => {
  it("aggregates runs, blocks, and asks per hook", async () => {
    const rows = await runQuery(
      db,
      "hooks",
      z.object({ hook: z.string(), runs: z.bigint(), blocks: z.bigint(), asks: z.bigint() }),
      filterParams({ event: null, hook: null }),
    );
    const tropes = rows.find((r) => r.hook.includes("check-tropes"));
    expect(tropes).toBeDefined();
    expect(Number(tropes?.asks)).toBe(2);
    const numbering = rows.find((r) => r.hook.includes("numbering.ts write"));
    expect(Number(numbering?.blocks)).toBe(1);
  });

  it("filters by hook glob", async () => {
    const rows = await runQuery(
      db,
      "hooks",
      z.object({ hook: z.string() }),
      filterParams({ event: null, hook: "*check-tropes*" }),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.hook).toContain("check-tropes");
  });

  it("attributes an isolated slow hook to itself", async () => {
    // The culprit outnumbers its peers in its hour, so this also guards
    // leave-one-out: a self-inclusive baseline would sit at the culprit's own
    // ~3000ms and report no excess.
    const rows = await runQuery(db, "hooks", Latency, filterParams({ event: null, hook: null }));
    const culprit = rows.find((r) => r.hook.includes("culprit.ts"));
    expect(Number(culprit?.p95_ms)).toBeGreaterThan(2500);
    expect(Number(culprit?.ambient_p50_ms)).toBeLessThan(200);
    expect(Number(culprit?.excess_p95_ms)).toBeGreaterThan(2500);
  });

  it("does not attribute a host-wide slowdown to any one hook", async () => {
    const rows = await runQuery(db, "hooks", Latency, filterParams({ event: null, hook: null }));
    const ambient = rows.find((r) => r.hook.includes("ambient-a.ts"));
    expect(Number(ambient?.p95_ms)).toBeGreaterThan(2500);
    expect(Number(ambient?.ambient_p50_ms)).toBeGreaterThan(2500);
    expect(Number(ambient?.excess_p95_ms)).toBeLessThan(100);
  });

  it("computes the ambient baseline before the hook filter", async () => {
    const rows = await runQuery(
      db,
      "hooks",
      Latency,
      filterParams({ event: null, hook: "*culprit*" }),
    );
    expect(rows.length).toBe(1);
    // The baseline comes from the hook's peers. Scoping to one hook must not
    // remove them, or every filtered run would look ambient-free.
    expect(rows[0]?.ambient_p50_ms).not.toBeNull();
    expect(Number(rows[0]?.ambient_p50_ms)).toBeLessThan(200);
  });

  it("reports no baseline for a hook with no timed runs", async () => {
    const rows = await runQuery(db, "hooks", Latency, filterParams({ event: null, hook: null }));
    const stop = rows.find((r) => r.hook === "Stop");
    expect(stop?.ambient_p50_ms).toBeNull();
    // GREATEST skips NULL arguments, so a missing baseline must not read as zero excess.
    expect(stop?.excess_p95_ms).toBeNull();
  });

  it("excludes untimed runs of a hook that has a baseline", async () => {
    const rows = await runQuery(db, "hooks", Latency, filterParams({ event: null, hook: null }));
    // partly-timed.ts has one 3000ms run against 70ms peers plus nine untimed
    // runs. Counting those as zero excess would drag the p95 down to ~1600.
    const partly = rows.find((r) => r.hook.includes("partly-timed.ts"));
    expect(Number(partly?.ambient_p50_ms)).toBeLessThan(200);
    expect(Number(partly?.excess_p95_ms)).toBeGreaterThan(2500);
  });
});

describe("catalog-reinjection-thrash-sessions query", () => {
  it("splits catalog injections into main-thread and sidechain", async () => {
    const rows = await runQuery(
      db,
      "catalog-reinjection-thrash-sessions",
      z.object({
        session_id: z.string(),
        main_injections: z.bigint(),
        sidechain_injections: z.bigint(),
        main_ktokens: z.number(),
        sidechain_ktokens: z.number(),
      }),
      filterParams({ min_injections: "6" }),
    );
    const row = rows.find((r) => r.session_id === "delegation-session");
    expect(Number(row?.main_injections)).toBe(2);
    expect(Number(row?.sidechain_injections)).toBe(12);
    expect(Number(row?.sidechain_ktokens)).toBeGreaterThan(Number(row?.main_ktokens));
  });
});

const Blocked = z.object({
  hook: z.string(),
  blocks: z.bigint(),
  denies: z.bigint(),
  asks: z.bigint(),
  recovered_denies: z.bigint(),
  subagent_blocks: z.bigint(),
  sessions: z.bigint(),
  agent_threads: z.bigint(),
  storm_threads: z.bigint(),
  max_burst: z.bigint(),
});
type Blocked = z.infer<typeof Blocked>;

describe("subagent attribution", () => {
  it("labels a workflow-nested subagent, which lives one directory deeper", async () => {
    // Roughly 40% of subagent transcripts land under subagents/workflows/wf_<id>/.
    // A pattern anchored on subagents/<file>.jsonl misses every one of them and
    // silently reclassifies the rows as main-thread.
    const rows = await db.query(
      "SELECT agent_id FROM tool_calls WHERE tool_id = 'attr-deny-1'",
      z.object({ agent_id: z.string().nullable() }),
    );
    expect(rows).toEqual([{ agent_id: "agent-nested" }]);
  });

  it("credits a spawn echoed into the subagent transcript to the parent", async () => {
    // The Agent tool_use appears in both transcripts under different uuids. The parent
    // made the call, so the main-thread copy has to win the cross-file dedup.
    const rows = await db.query(
      "SELECT agent_id FROM tool_calls WHERE tool_id = 'attr-spawn-1'",
      z.object({ agent_id: z.string().nullable() }),
    );
    expect(rows).toEqual([{ agent_id: null }]);
  });
});

describe("hook-blocks query", () => {
  it("groups by signature and counts repeat storms within a session", async () => {
    const rows = await runQuery(db, "hook-blocks", Blocked, filterParams({ hook: null }));
    const emdash = rows.find((r) => r.hook.includes("check-tropes"));
    expect(Number(emdash?.blocks)).toBe(2);
    expect(Number(emdash?.asks)).toBe(2);
    // Both em-dash asks land in one session, so it is a storm of burst 2.
    expect(Number(emdash?.storm_threads)).toBe(1);
    expect(Number(emdash?.max_burst)).toBe(2);
  });

  it("recovers a PreToolUse deny that left no hook record", async () => {
    const rows = await runQuery(db, "hook-blocks", Blocked, filterParams({ hook: null }));
    const denied = rows.find((r) => r.hook === "git:block-default-branch-commit");
    // One deny on a main thread plus three from the subagent fixtures.
    expect(Number(denied?.blocks)).toBe(4);
    expect(Number(denied?.denies)).toBe(4);
    expect(Number(denied?.recovered_denies)).toBe(4);
  });

  it("keys a burst on the agent thread, not the session a subagent inherits", async () => {
    // A subagent writes its own transcript but stamps every line with the parent's
    // sessionId. Keyed on the session, hooks-session's one main-thread deny and two
    // subagent denies read as a single burst of 3 by the parent. They are three
    // independent contexts, so the worst burst is the one subagent that hit it twice.
    const rows = await runQuery(db, "hook-blocks", Blocked, filterParams({ hook: null }));
    const denied = rows.find((r) => r.hook === "git:block-default-branch-commit");
    expect(Number(denied?.max_burst)).toBe(2);
    expect(Number(denied?.sessions)).toBe(2);
    // hooks-session's main thread, its subagent, and the nested workflow subagent.
    // A NULL agent_id groups as its own context rather than dropping out of the count.
    expect(Number(denied?.agent_threads)).toBe(3);
    expect(Number(denied?.subagent_blocks)).toBe(3);
  });

  it("names the subagent that was denied and leaves the parent's own deny unlabelled", async () => {
    const rows = await db.query(
      "SELECT tool_use_id, agent_id FROM hook_denies WHERE tool_use_id LIKE 'hk-%deny-1'",
      z.object({ tool_use_id: z.string(), agent_id: z.string().nullable() }),
    );
    expect(Object.fromEntries(rows.map((r) => [r.tool_use_id, r.agent_id]))).toEqual({
      "hk-deny-1": null,
      "hk-sub-deny-1": "agent-mine-hooks",
    });
  });

  it("does not recount an ask the user declined as a recovered deny", async () => {
    // A declined ask leaves both a hook record and an error carrying the same reason
    // text. Counting both would inflate every hook that asks.
    const rows = await runQuery(
      db,
      "hook-blocks",
      z.object({ hook: z.string(), recovered_denies: z.bigint() }),
      filterParams({ hook: null }),
    );
    const emdash = rows.find((r) => r.hook.includes("check-tropes"));
    expect(Number(emdash?.recovered_denies)).toBe(0);
  });
});

describe("hook-origin-split query", () => {
  it("counts a project-dir .claude/hooks script as project_local, not shared config", async () => {
    const rows = await runQuery(
      db,
      "hook-origin-split",
      z.object({ origin: z.string(), fires: z.bigint(), total_s: z.number().nullable() }),
      filterParams(),
    );
    const local = rows.find((r) => r.origin === "project_local");
    const shared = rows.find((r) => r.origin === "shared_config");
    expect(Number(local?.fires)).toBeGreaterThan(0);
    // The ruff.sh fire is the slowest hook in the fixture at 2.4s. Landing it in
    // shared_config would put a repo's latency on the portable config's bill.
    expect(Number(local?.total_s)).toBeGreaterThanOrEqual(2.4);
    expect(Number(shared?.fires)).toBeGreaterThan(0);
  });
});

describe("fields discovery query", () => {
  it("enumerates the keys of an attachment kind via schema inference", async () => {
    const rows = await runQuery(
      db,
      "fields",
      z.object({ field: z.string(), json_type: z.string() }),
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
    const rows = await runQuery(
      db,
      "activity",
      z.object({ signal: z.string(), count: z.bigint() }),
      filterParams(),
    );
    const bySignal = new Map(rows.map((r) => [r.signal, Number(r.count)]));
    expect(bySignal.get("prompt: typed")).toBe(2);
    expect(bySignal.get("prompt: queued")).toBe(1);
    expect(bySignal.get("prompt: system")).toBe(1);
    // `promptSource` calls this turn `queued`; the attachment says who queued it.
    expect(bySignal.get("queued command: auto-continuation")).toBe(1);
    expect(bySignal.get("interruptions")).toBe(1);
    expect(bySignal.get("compactions")).toBe(1);
    expect(bySignal.get("mode: auto")).toBe(1);
    // hooks-session contributes one, plan-iterations-session (added for the
    // plan-iterations query) contributes a second.
    expect(bySignal.get("mode: plan")).toBe(2);
    // seven system:api_error records plus two assistant isApiErrorMessage
    // markers, the surface that replaced it in newer CLI versions
    expect(bySignal.get("api errors/retries")).toBe(9);
  });

  it("scopes timestamp-less signals by their session's last activity", async () => {
    const windowed = await runQuery(
      db,
      "activity",
      z.object({ signal: z.string(), count: z.bigint() }),
      filterParams({ after_date: "2024-01-01", before_date: "2024-02-15" }),
    );
    const inWindow = new Map(windowed.map((r) => [r.signal, Number(r.count)]));
    expect(inWindow.get("mode: plan")).toBe(2);

    const later = await runQuery(
      db,
      "activity",
      z.object({ signal: z.string(), count: z.bigint() }),
      filterParams({ after_date: "2025-01-01" }),
    );
    const outOfWindow = new Map(later.map((r) => [r.signal, Number(r.count)]));
    expect(outOfWindow.get("mode: plan")).toBeUndefined();
  });
});

describe("diagnostics view and query", () => {
  it("unnests one row per diagnostic with severity, source, and code", async () => {
    const rows = await db.query(
      "SELECT severity, source, code, file FROM diagnostics ORDER BY severity",
      z.object({ severity: z.string(), source: z.string(), code: z.string(), file: z.string() }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.severity).toBe("Error");
    expect(rows[0]?.source).toBe("ty");
    expect(rows[0]?.code).toBe("unresolved-import");
    expect(rows[0]?.file).toBe("/Users/test/project/app.py");
  });

  it("groups recurring diagnostics by code", async () => {
    const rows = await runQuery(
      db,
      "diagnostics",
      z.object({ code: z.string(), occurrences: z.bigint(), files: z.bigint() }),
      filterParams(),
    );
    const imp = rows.find((r) => r.code === "unresolved-import");
    expect(Number(imp?.occurrences)).toBe(1);
    expect(Number(imp?.files)).toBe(1);
  });
});

describe("file_operations view and files query", () => {
  it("captures file edits with the attributed skill", async () => {
    const [row] = await db.query(
      "SELECT operation, attribution_skill FROM file_operations WHERE file_path = '/Users/test/project/doc.md' AND operation = 'Write'",
      z.object({ operation: z.string(), attribution_skill: z.string() }),
    );
    expect(row?.operation).toBe("Write");
    expect(row?.attribution_skill).toBe("writing:writing");
  });

  it("ranks files by edits", async () => {
    const rows = await runQuery(
      db,
      "files",
      z.object({ file_path: z.string(), edits: z.bigint() }),
      filterParams({ limit: "20" }),
    );
    const doc = rows.find((r) => r.file_path === "/Users/test/project/doc.md");
    expect(Number(doc?.edits)).toBeGreaterThanOrEqual(1);
  });
});

describe("pr_links view", () => {
  it("dedupes re-emitted links to one row keeping the first emission's timestamp", async () => {
    const rows = await db.query(
      "SELECT pr_number, repository, timestamp::VARCHAR AS ts FROM pr_links WHERE session_id = 'hooks-session'",
      z.object({ pr_number: z.bigint(), repository: z.string(), ts: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.pr_number)).toBe(42);
    expect(rows[0]?.repository).toBe("test/project");
    expect(rows[0]?.ts).toStartWith("2024-01-19 10:08:30");
  });
});

describe("outcomes query", () => {
  const metrics = (rows: { metric: string; count: bigint }[]) =>
    Object.fromEntries(rows.map((r) => [r.metric, Number(r.count)]));

  it("classifies every session's terminal state", async () => {
    const rows = await runQuery(
      db,
      "outcomes",
      z.object({ metric: z.string(), count: z.bigint() }),
      filterParams({ ongoing_hours: null }),
    );
    // shipped covers both signals: hooks-session via its pr-link record,
    // ship-session via a git push Bash command with no pr-link
    expect(metrics(rows)).toEqual({
      "sessions: shipped": 2,
      "sessions: ongoing": 1,
      "sessions: handed-off": 1,
      "sessions: abandoned-with-edits": 3,
      "sessions: no-artifact": 18,
      "prs opened (distinct urls)": 1,
      "prs needing multiple sessions": 0,
    });
  });

  it("widens the ongoing window via ongoing_hours without reclassifying shipped work", async () => {
    const rows = await runQuery(
      db,
      "outcomes",
      z.object({ metric: z.string(), count: z.bigint() }),
      filterParams({ ongoing_hours: "1000" }),
    );
    // 1000 hours reaches past the corpus start, so every unshipped session
    // reads as ongoing; the shipped ones keep their state
    expect(metrics(rows)).toEqual({
      "sessions: shipped": 2,
      "sessions: ongoing": 23,
      "prs opened (distinct urls)": 1,
      "prs needing multiple sessions": 0,
    });
  });
});

describe("delegation query", () => {
  // delegation-session (opus main model) spawns five Agent calls: an Explore call
  // left to inherit (actual model opus, via its subagent transcript), which lands
  // on the generic path because Explore inherits the parent model (capped at Opus)
  // rather than pinning Haiku, a generic call with an explicit `model: haiku`
  // override (actual haiku, a cheaper override), a pinned `github:logs` call
  // (actual haiku, no override needed), a fork (must be excluded entirely), and a
  // generic call with an explicit `model: sonnet` override resolved via the tool
  // result's `resolvedModel` rather than a transcript join (actual sonnet, cheaper
  // override).
  const DelegationRow = z.object({
    parent_family: z.string(),
    path: z.string(),
    actual_family: z.string(),
    spawns: z.bigint(),
    path_spawns: z.bigint(),
    pct_of_path: z.number(),
    override_rate_pct: z.number(),
    cheaper_override_rate_pct: z.number(),
    expensive_output_tokens: z.bigint(),
    expensive_cache_creation_tokens: z.bigint(),
  });
  type DelegationRow = z.infer<typeof DelegationRow>;

  async function delegationRows() {
    return runQuery(db, "delegation", DelegationRow, filterParams());
  }

  it("excludes fork spawns entirely", async () => {
    const rows = await delegationRows();
    const total = rows
      .filter((r) => r.parent_family === "opus")
      .reduce((sum, r) => sum + Number(r.spawns), 0);
    // 5 calls minus the excluded fork leaves 4 counted spawns.
    expect(total).toBe(4);
  });

  it("separates the generic path from the pinned-agent path", async () => {
    const rows = await delegationRows();
    const generic = rows.find((r) => r.parent_family === "opus" && r.path === "generic");
    const pinned = rows.filter((r) => r.parent_family === "opus" && r.path === "pinned");
    expect(Number(generic?.path_spawns)).toBe(3);
    expect(Number(pinned[0]?.path_spawns)).toBe(1);
    expect(pinned.map((r) => r.actual_family)).toEqual(["haiku"]);
  });

  it("counts an Explore spawn as generic, since it inherits the parent model rather than pinning Haiku", async () => {
    const rows = await delegationRows();
    // The Explore spawn ran on opus (inherited from the opus parent, capped) and
    // carried no override, so it is a real delegation miss on the generic path.
    // The only pinned spawn is github:logs on haiku. Nothing opus-family reaches
    // the pinned path, which is what a pre-fix (Explore-pinned) query would show.
    const pinned = rows.filter((r) => r.parent_family === "opus" && r.path === "pinned");
    expect(pinned.map((r) => r.actual_family)).toEqual(["haiku"]);
    const genericOpus = rows.find(
      (r) => r.parent_family === "opus" && r.path === "generic" && r.actual_family === "opus",
    );
    expect(Number(genericOpus?.spawns)).toBe(1);
  });

  it("resolves the actual model from the subagent transcript when the tool result carries no resolvedModel", async () => {
    const rows = await delegationRows();
    const inherited = rows.find(
      (r) => r.parent_family === "opus" && r.path === "generic" && r.actual_family === "opus",
    );
    expect(Number(inherited?.spawns)).toBe(1);
  });

  it("resolves the actual model from resolvedModel when the tool result carries it", async () => {
    const rows = await delegationRows();
    const resolved = rows.find(
      (r) => r.parent_family === "opus" && r.path === "generic" && r.actual_family === "sonnet",
    );
    expect(Number(resolved?.spawns)).toBe(1);
  });

  it("computes override and cheaper-override rates as a fraction of every spawn in the group", async () => {
    const rows = await delegationRows();
    const generic = rows.find((r) => r.parent_family === "opus" && r.path === "generic");
    // 2 of 3 generic spawns carried an explicit override (haiku, sonnet), and
    // both were cheaper than the opus main model.
    expect(generic?.override_rate_pct).toBeCloseTo(66.7, 1);
    expect(generic?.cheaper_override_rate_pct).toBeCloseTo(66.7, 1);
    const pinned = rows.find((r) => r.parent_family === "opus" && r.path === "pinned");
    expect(pinned?.override_rate_pct).toBe(0);
  });

  it("sums expensive-model spend only from spawns whose actual family is opus/fable", async () => {
    const rows = await delegationRows();
    const generic = rows.filter((r) => r.parent_family === "opus" && r.path === "generic");
    // Only the inherited (actual opus) spawn's subagent transcript counts.
    for (const row of generic) {
      expect(Number(row.expensive_output_tokens)).toBe(500);
      expect(Number(row.expensive_cache_creation_tokens)).toBe(200);
    }
    const pinned = rows.filter((r) => r.parent_family === "opus" && r.path === "pinned");
    for (const row of pinned) {
      expect(Number(row.expensive_output_tokens)).toBe(0);
    }
  });
});

describe("review-precision query", () => {
  // review-session reports four findings, then re-reports the same four with outcomes
  // after the --fix pass, so every count here also proves the dedupe: without it
  // correctness reads 4 findings in that session instead of 2. review-mixed-session
  // carries two correctness findings on one line (same file:line, different claim) at
  // high effort, plus a documentation finding from a user-typed /code-review, which
  // carries no skill attribution.
  const PrecisionRow = z.object({
    category: z.string(),
    level: z.string(),
    findings: z.bigint(),
    sessions: z.bigint(),
    confirmed: z.bigint(),
    plausible: z.bigint(),
    refuted: z.bigint(),
    unverified: z.bigint(),
    confirmed_pct: z.number().nullable(),
    fixed: z.bigint(),
    no_change: z.bigint(),
    skipped: z.bigint(),
    acted_pct: z.number().nullable(),
  });
  type PrecisionRow = z.infer<typeof PrecisionRow>;

  function precisionRows(overrides: Record<string, string | null> = {}) {
    return runQuery(
      db,
      "review-precision",
      PrecisionRow,
      filterParams({ skill: null, min_findings: null, ...overrides }),
    );
  }

  function format(rows: PrecisionRow[]) {
    return rows
      .map(
        (r) =>
          `${r.category}/${r.level} findings=${r.findings} sessions=${r.sessions} ` +
          `verdicts=${r.confirmed}/${r.plausible}/${r.refuted}/${r.unverified} ` +
          `confirmed_pct=${r.confirmed_pct} ` +
          `outcomes=${r.fixed}/${r.no_change}/${r.skipped} acted_pct=${r.acted_pct}`,
      )
      .join("\n");
  }

  it("rolls each angle up and splits it by effort level", async () => {
    expect(format(await precisionRows())).toMatchInlineSnapshot(`
      "correctness/all findings=4 sessions=2 verdicts=2/1/1/0 confirmed_pct=50 outcomes=1/0/1 acted_pct=50
      correctness/high findings=2 sessions=1 verdicts=1/0/1/0 confirmed_pct=50 outcomes=0/0/0 acted_pct=null
      correctness/medium findings=2 sessions=1 verdicts=1/1/0/0 confirmed_pct=50 outcomes=1/0/1 acted_pct=50
      altitude/all findings=1 sessions=1 verdicts=1/0/0/0 confirmed_pct=100 outcomes=0/1/0 acted_pct=0
      altitude/medium findings=1 sessions=1 verdicts=1/0/0/0 confirmed_pct=100 outcomes=0/1/0 acted_pct=0
      documentation/all findings=1 sessions=1 verdicts=1/0/0/0 confirmed_pct=100 outcomes=0/0/0 acted_pct=null
      documentation/medium findings=1 sessions=1 verdicts=1/0/0/0 confirmed_pct=100 outcomes=0/0/0 acted_pct=null
      reuse/all findings=1 sessions=1 verdicts=0/0/0/1 confirmed_pct=null outcomes=1/0/0 acted_pct=100
      reuse/medium findings=1 sessions=1 verdicts=0/0/0/1 confirmed_pct=null outcomes=1/0/0 acted_pct=100"
    `);
  });

  it("scopes to one calling skill, dropping the unattributed built-in review", async () => {
    expect(format(await precisionRows({ skill: "review:code" }))).toMatchInlineSnapshot(`
      "correctness/all findings=4 sessions=2 verdicts=2/1/1/0 confirmed_pct=50 outcomes=1/0/1 acted_pct=50
      correctness/high findings=2 sessions=1 verdicts=1/0/1/0 confirmed_pct=50 outcomes=0/0/0 acted_pct=null
      correctness/medium findings=2 sessions=1 verdicts=1/1/0/0 confirmed_pct=50 outcomes=1/0/1 acted_pct=50
      altitude/all findings=1 sessions=1 verdicts=1/0/0/0 confirmed_pct=100 outcomes=0/1/0 acted_pct=0
      altitude/medium findings=1 sessions=1 verdicts=1/0/0/0 confirmed_pct=100 outcomes=0/1/0 acted_pct=0
      reuse/all findings=1 sessions=1 verdicts=0/0/0/1 confirmed_pct=null outcomes=1/0/0 acted_pct=100
      reuse/medium findings=1 sessions=1 verdicts=0/0/0/1 confirmed_pct=null outcomes=1/0/0 acted_pct=100"
    `);
  });

  it("floors the long tail on the angle's rollup total, not its per-level rows", async () => {
    const rows = await precisionRows({ min_findings: "2" });
    expect(rows.map((r) => `${r.category}/${r.level}`)).toEqual([
      "correctness/all",
      "correctness/high",
      "correctness/medium",
    ]);
  });
});

describe("change catalog", () => {
  it("indexes a file rsynced in with an old mtime after the host was imported", async () => {
    await importFixtureHost("work");
    await reindex();

    // rsync -a re-syncs deliver new files with preserved (old) source mtimes.
    const late = path.join(importsDir, "work", "projects", "-Users-test-project", "late.jsonl");
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
    const target = path.join(
      importsDir,
      "edited",
      "projects",
      "-Users-test-project",
      "basic.jsonl",
    );
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
    const target = path.join(
      importsDir,
      "shrinking",
      "projects",
      "-Users-test-project",
      "basic.jsonl",
    );
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
    await rm(path.join(importsDir, "unmounted", "projects"), { recursive: true, force: true });
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

      const subdir = path.join(importsDir, "guarded", "projects", "-Users-test-project");
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
    const gone = path.join(tmpDir, "gone");
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

    await rm(path.join(importsDir, "detached", "projects"), { recursive: true, force: true });
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

    const projects = path.join(importsDir, "archived", "projects");
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

    db = await getDb(tmpDir);
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

describe("source_line", () => {
  it("numbers ingested rows 1..N per file", async () => {
    const rows = await db.query(
      `SELECT source_file, COUNT(*) AS n, MIN(source_line) AS lo,
              MAX(source_line) AS hi, COUNT(DISTINCT source_line) AS d
       FROM raw WHERE host = 'local' GROUP BY source_file`,
      z.object({
        source_file: z.string(),
        n: z.bigint(),
        lo: z.bigint(),
        hi: z.bigint(),
        d: z.bigint(),
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Number(row.lo)).toBe(1);
      expect(Number(row.hi)).toBe(Number(row.n));
      expect(Number(row.d)).toBe(Number(row.n));
    }
  });
});

describe("attribution and skill-activity query", () => {
  it("exposes attribution on tool_calls", async () => {
    const [row] = await db.query(
      "SELECT attribution_skill FROM tool_calls WHERE tool_id = 'hk-write-1'",
      z.object({ attribution_skill: z.string() }),
    );
    expect(row?.attribution_skill).toBe("writing:writing");
  });

  it("aggregates attributed work and tokens per skill", async () => {
    const rows = await runQuery(
      db,
      "skill-activity",
      z.object({ skill: z.string(), assistant_turns: z.bigint() }),
      filterParams(),
    );
    const writing = rows.find((r) => r.skill === "writing:writing");
    expect(Number(writing?.assistant_turns)).toBeGreaterThanOrEqual(1);
  });
});

describe("skill-auto-vs-explicit query", () => {
  const Split = z.object({
    skill_name: z.string(),
    model_auto: z.bigint(),
    chained: z.bigint(),
    explicit: z.bigint(),
    total: z.bigint(),
  });
  type Split = z.infer<typeof Split>;

  it("counts a Skill call carrying args as model routing, not an explicit invocation", async () => {
    const rows = await runQuery(
      db,
      "skill-auto-vs-explicit",
      Split,
      filterParams({ min_calls: null }),
    );
    const peer = rows.find((r) => r.skill_name === "review:peer");
    // Both review:peer calls pass args and neither was typed as a slash command.
    expect(Number(peer?.model_auto)).toBe(2);
    expect(Number(peer?.chained)).toBe(0);
  });

  it("counts a typed slash command as explicit and a skill-attributed call as chained", async () => {
    const rows = await runQuery(
      db,
      "skill-auto-vs-explicit",
      Split,
      filterParams({ min_calls: null }),
    );
    const peer = rows.find((r) => r.skill_name === "review:peer");
    expect(Number(peer?.explicit)).toBe(1);
    const create = rows.find((r) => r.skill_name === "pull-request:create");
    expect(Number(create?.model_auto)).toBe(1);
    expect(Number(create?.chained)).toBe(1);
    expect(Number(create?.explicit)).toBe(0);
  });

  it("keeps an unnamespaced skill from absorbing unparsed command markers", async () => {
    const rows = await runQuery(
      db,
      "skill-auto-vs-explicit",
      Split,
      filterParams({ min_calls: null }),
    );
    const solo = rows.find((r) => r.skill_name === "solo");
    expect(Number(solo?.explicit)).toBe(0);
    expect(Number(solo?.total)).toBe(1);
  });
});

describe("plan_calls view and plans query", () => {
  it("classifies a redirected plan as outcome=redirected with plan_seq=1", async () => {
    const rows = await db.query(
      "SELECT session_id, outcome, plan_seq, plan_chars, plan_file FROM plan_calls WHERE session_id = 'plan-session' ORDER BY plan_seq",
      z.object({
        session_id: z.string(),
        outcome: z.string(),
        plan_seq: z.bigint(),
        plan_chars: z.bigint(),
        plan_file: z.string(),
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.outcome).toBe("redirected");
    expect(Number(rows[0]?.plan_seq)).toBe(1);
    expect(Number(rows[0]?.plan_chars)).toBeGreaterThan(0);
    expect(rows[0]?.plan_file).toContain("plan-session");
  });

  it("classifies the second plan (after approval) as outcome=approved with plan_seq=2", async () => {
    const rows = await db.query(
      "SELECT outcome, plan_seq FROM plan_calls WHERE session_id = 'plan-session' ORDER BY plan_seq",
      z.object({ outcome: z.string(), plan_seq: z.bigint() }),
    );
    expect(rows[1]?.outcome).toBe("approved");
    expect(Number(rows[1]?.plan_seq)).toBe(2);
  });

  it("aggregates plan_sessions with correct counts and replan tier", async () => {
    const [row] = await db.query(
      "SELECT plan_count, redirect_count, approved_count FROM plan_sessions WHERE session_id = 'plan-session'",
      z.object({ plan_count: z.bigint(), redirect_count: z.bigint(), approved_count: z.bigint() }),
    );
    expect(Number(row?.plan_count)).toBe(2);
    expect(Number(row?.redirect_count)).toBe(1);
    expect(Number(row?.approved_count)).toBe(1);
  });

  it("reports the session via the plans query with replan_tier=replan", async () => {
    const rows = await runQuery(
      db,
      "plans",
      z.object({ session_id: z.string(), replan_tier: z.string(), plan_count: z.bigint() }),
      { after_date: null, before_date: null, project: null, host: null, min_plans: null },
    );
    const row = rows.find((r) => r.session_id === "plan-session");
    expect(row).toBeDefined();
    expect(row?.replan_tier).toBe("replan");
    expect(Number(row?.plan_count)).toBe(2);
  });

  it("excludes sessions below min_plans threshold", async () => {
    const rows = await runQuery(db, "plans", z.object({ session_id: z.string() }), {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "3",
    });
    expect(rows.find((r) => r.session_id === "plan-session")).toBeUndefined();
  });

  it("classifies a terminal rejection with no edits after as outcome=handoff", async () => {
    // handoff-session ends on a rejected plan followed only by a Read, the
    // reject-and-handoff workflow (implement from the plan file in a fresh session).
    const rows = await db.query(
      "SELECT outcome FROM plan_calls WHERE session_id = 'handoff-session'",
      z.object({ outcome: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("handoff");
  });

  it("classifies the 'approved exiting plan mode' wording as outcome=approved", async () => {
    // The harness has shipped more than one approval string. Matching only "approved
    // your plan" dropped this one into 'unknown', which reads as a plan the user never
    // approved. A new wording should fail here rather than silently misclassify.
    const rows = await db.query(
      "SELECT outcome FROM plan_calls WHERE session_id = 'plan-approve-variant-session'",
      z.object({ outcome: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("approved");
  });

  it("keeps a terminal rejection followed by file edits as outcome=redirected", async () => {
    const rows = await db.query(
      "SELECT outcome FROM plan_calls WHERE session_id = 'plan-abandon-session'",
      z.object({ outcome: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("redirected");
  });

  it("counts handoffs separately from redirects in plan_sessions", async () => {
    const [row] = await db.query(
      "SELECT redirect_count, handoff_count FROM plan_sessions WHERE session_id = 'handoff-session'",
      z.object({ redirect_count: z.bigint(), handoff_count: z.bigint() }),
    );
    expect(Number(row?.redirect_count)).toBe(0);
    expect(Number(row?.handoff_count)).toBe(1);
  });

  it("tiers a handoff-only session as single, keyed on mid-session redirects", async () => {
    const rows = await runQuery(
      db,
      "plans",
      z.object({ session_id: z.string(), replan_tier: z.string(), handoff_count: z.bigint() }),
      { after_date: null, before_date: null, project: null, host: null, min_plans: null },
    );
    const handoff = rows.find((r) => r.session_id === "handoff-session");
    expect(handoff?.replan_tier).toBe("single");
    expect(Number(handoff?.handoff_count)).toBe(1);
  });
});

describe("plan-iterations query", () => {
  // plan-iterations-session presents three plans: A,B,C (rejected) -> A,B,C,D,E
  // (rejected, append-only) -> A,D,F (approved, a real prune). Exercises growth,
  // carry-over, and removal in the same session.
  const PlanIterationRow = z.object({
    sid: z.string(),
    plan_seq: z.bigint(),
    outcome: z.string(),
    lines_added: z.bigint().nullable(),
    lines_removed: z.bigint().nullable(),
    lines_carried: z.bigint().nullable(),
    carry_over_ratio: z.number().nullable(),
    secs_since_prev: z.bigint().nullable(),
    secs_to_first_plan: z.bigint().nullable(),
    human_msgs: z.bigint(),
  });
  type PlanIterationRow = z.infer<typeof PlanIterationRow>;

  async function planIterationRows() {
    const rows = await runQuery(db, "plan-iterations", PlanIterationRow, {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "1",
    });
    return rows
      .filter((r) => r.sid === "plan-ite")
      .toSorted((a, b) => Number(a.plan_seq) - Number(b.plan_seq));
  }

  it("leaves growth/removal/carry-over and secs_since_prev null on the first present", async () => {
    const rows = await planIterationRows();
    expect(rows).toHaveLength(3);
    const first = rows[0];
    expect(first?.outcome).toBe("redirected");
    expect(first?.lines_added).toBeNull();
    expect(first?.lines_removed).toBeNull();
    expect(first?.lines_carried).toBeNull();
    expect(first?.carry_over_ratio).toBeNull();
    expect(first?.secs_since_prev).toBeNull();
  });

  it("measures append-only growth on the second present: added 2, removed 0, carried 3, ratio 0.60", async () => {
    const rows = await planIterationRows();
    const second = rows[1];
    expect(second?.outcome).toBe("redirected");
    expect(Number(second?.lines_added)).toBe(2);
    expect(Number(second?.lines_removed)).toBe(0);
    expect(Number(second?.lines_carried)).toBe(3);
    expect(second?.carry_over_ratio).toBe(0.6);
    expect(Number(second?.secs_since_prev)).toBe(300);
  });

  it("measures a real prune on the third present: added 1, removed 3, carried 2", async () => {
    const rows = await planIterationRows();
    const third = rows[2];
    expect(third?.outcome).toBe("approved");
    expect(Number(third?.lines_added)).toBe(1);
    expect(Number(third?.lines_removed)).toBe(3);
    expect(Number(third?.lines_carried)).toBe(2);
    expect(Number(third?.secs_since_prev)).toBe(300);
  });

  it("reports secs_to_first_plan from the plan-mode record and human_msgs from last-prompt records, repeated on every row", async () => {
    const rows = await planIterationRows();
    for (const row of rows) {
      expect(Number(row.secs_to_first_plan)).toBe(300);
      expect(Number(row.human_msgs)).toBe(2);
    }
  });

  it("excludes sessions below min_plans threshold", async () => {
    const rows = await runQuery(db, "plan-iterations", PlanIterationRow, {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "4",
    });
    expect(rows.find((r) => r.sid === "plan-ite")).toBeUndefined();
  });
});

describe("replayed line dedupe", () => {
  // replay.jsonl duplicates its tool_use, tool_result, and hook attachment lines
  // verbatim (same uuid) further down the file, the rewind/resume replay shape.
  it("keeps one content_items row per replayed tool_use and tool_result", async () => {
    const uses = await db.query(
      "SELECT COUNT(*) AS n FROM content_items WHERE type = 'tool_use' AND id = 'rp-tool-1'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(uses[0]?.n)).toBe(1);
    const results = await db.query(
      "SELECT COUNT(*) AS n FROM content_items WHERE type = 'tool_result' AND tool_use_id = 'rp-tool-1'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(results[0]?.n)).toBe(1);
  });

  it("keeps one tool_calls row per replayed tool_use", async () => {
    const rows = await db.query(
      "SELECT COUNT(*) AS n FROM tool_calls WHERE tool_id = 'rp-tool-1'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("keeps one hook_events row per replayed hook attachment", async () => {
    const rows = await db.query(
      "SELECT COUNT(*) AS n FROM hook_events WHERE session_id = 'replay-session' AND kind = 'hook_blocking_error'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe("stop-hook-noop-detector query", () => {
  const NoopRow = z.object({
    command: z.string(),
    fires: z.bigint(),
    total_ms: z.bigint(),
    events: z.bigint(),
    with_stdout: z.bigint(),
    with_decision: z.bigint(),
    nonzero_exit: z.bigint(),
    blocks: z.bigint(),
    gated_stops: z.bigint(),
  });

  async function detect() {
    const rows = await runQuery(db, "stop-hook-noop-detector", NoopRow, filterParams());
    return new Map(rows.map((r) => [r.command, r]));
  }

  it("surfaces a hook that fires and writes nothing to the attachment channel", async () => {
    const silent = (await detect()).get("bun ${CLAUDE_PLUGIN_ROOT}/hooks/silent-stop.ts");
    expect(silent).toBeDefined();
    expect(Number(silent?.fires)).toBe(2);
    expect(Number(silent?.total_ms)).toBe(82);
    expect(Number(silent?.events)).toBe(0);
    expect(Number(silent?.with_stdout)).toBe(0);
    expect(Number(silent?.blocks)).toBe(0);
  });

  it("pairs a rostered hook with the attachments it wrote", async () => {
    const test = (await detect()).get("make test-unit");
    expect(Number(test?.fires)).toBe(1);
    expect(Number(test?.events)).toBe(1);
  });

  it("counts blocking errors so a Stop gate is not a noop candidate", async () => {
    // Blocking errors carry no command, so they group under the bare hook name, and the
    // roster names the hook that ran rather than the event, so they match no fires.
    const gate = (await detect()).get("Stop");
    expect(gate).toBeDefined();
    expect(Number(gate?.fires)).toBe(0);
    expect(Number(gate?.blocks)).toBe(Number(gate?.events));
    expect(Number(gate?.blocks)).toBeGreaterThan(0);
  });

  it("marks the hooks that ran at a gated Stop, since the gate names no command", async () => {
    const rows = await detect();
    // Both rostered hooks share the blocked Stop's toolUseID. `silent-stop` also fires at
    // an ungated Stop, so a silent hook that may be the gate is distinguishable from one
    // that never ran at a blocked Stop.
    expect(Number(rows.get("bun ${CLAUDE_PLUGIN_ROOT}/hooks/silent-stop.ts")?.gated_stops)).toBe(1);
    expect(Number(rows.get("make test-unit")?.gated_stops)).toBe(1);
  });

  it("excludes a queued prompt the harness re-injected at Stop", async () => {
    expect((await detect()).has("monitor CI until it goes green")).toBe(false);
  });
});

describe("plan-sections query", () => {
  const plansGlob = path.join(plansFixtureDir, "*.md");
  const featurePlan = path.join(plansFixtureDir, "feature-plan.md");

  const Section = z.object({
    session_id: z.string().nullable(),
    outcome: z.string().nullable(),
    title: z.string(),
    level: z.number(),
    file_path: z.string(),
  });
  type Section = z.infer<typeof Section>;

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
      // oxlint-disable-next-line no-await-in-loop -- rows insert in fixture order on one connection so the assertions see a fixed layout.
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
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });
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
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });
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
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });

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
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });
    expect(rows.some((r) => r.session_id === "plan-session")).toBe(false);
  });
});

describe("skill-config-vs-observed query", () => {
  const skillsFixtureDir = path.join(import.meta.dirname, "..", "fixtures", "skills");

  const SkillRow = z.object({
    source: z.string(),
    skill_name: z.string(),
    description_chars: z.bigint(),
    disable_model_invocation: z.boolean(),
    calls: z.bigint(),
    sessions: z.bigint(),
    last_seen: z.date().nullable(),
  });
  type SkillRow = z.infer<typeof SkillRow>;

  beforeEach(async () => {
    await loadExtensions(db);
  });

  async function skillRows(overrides: Record<string, string | null> = {}) {
    return runQuery(
      db,
      "skill-config-vs-observed",
      SkillRow,
      filterParams({
        skill: null,
        plugin_skill_glob: path.join(skillsFixtureDir, "cache/*/*/*/skills/*/SKILL.md"),
        user_skill_glob: path.join(skillsFixtureDir, "user/*/SKILL.md"),
        project_skill_glob: path.join(skillsFixtureDir, "project/*/SKILL.md"),
        ...overrides,
      }),
    );
  }

  it("counts observed calls for a plugin skill, pinning one cache copy", async () => {
    const rows = await skillRows();
    const peer = rows.filter((r) => r.skill_name === "review:peer");
    expect(peer).toHaveLength(1);
    expect(peer[0]?.source).toBe("plugin:test-marketplace/review");
    expect(Number(peer[0]?.calls)).toBe(2);
    expect(Number(peer[0]?.sessions)).toBe(1);
    expect(peer[0]?.last_seen).not.toBeNull();
  });

  it("matches bare observed calls to an entry skill (plugin = skill)", async () => {
    const rows = await skillRows();
    const solo = rows.find((r) => r.skill_name === "solo:solo");
    expect(Number(solo?.calls)).toBe(1);
  });

  it("sorts zero-fire skills first across all three sources", async () => {
    const rows = await skillRows();
    const zero = rows.filter((r) => Number(r.calls) === 0).map((r) => r.skill_name);
    expect(
      ["review:inbox", "never-used", "scratch"].filter((name) => !zero.includes(name)),
    ).toEqual([]);
    expect(rows.slice(0, zero.length).every((r) => Number(r.calls) === 0)).toBe(true);

    const never = rows.find((r) => r.skill_name === "never-used");
    expect(never?.source).toBe("user:~/.claude/skills");
    expect(never?.disable_model_invocation).toBe(true);
    expect(never?.last_seen).toBeNull();
    expect(Number(never?.sessions)).toBe(0);
    expect(Number(never?.description_chars)).toBeGreaterThan(0);
  });

  it("filters configured names by skill glob", async () => {
    const rows = await skillRows({ skill: "review:*" });
    expect(rows.map((r) => r.skill_name).toSorted()).toEqual(["review:inbox", "review:peer"]);
  });
});

describe("index-health query", () => {
  const projectsGlob = path.join(fixturesDir, "**", "*.jsonl");

  const Health = z.object({
    check_name: z.string(),
    status: z.string(),
    subject: z.string(),
    detail: z.string(),
  });
  type Health = z.infer<typeof Health>;

  function healthParams(overrides: Record<string, string | null> = {}) {
    return {
      projects_glob: projectsGlob,
      min_active_days: null,
      new_days: null,
      stale_days: null,
      deny_window_days: null,
      ...overrides,
    };
  }

  it("alerts when recovered hook denies outnumber the denies hook_events recorded", async () => {
    // A window wide enough to cover the whole fixture corpus, so the check reads the
    // same rows regardless of when the newest fixture record is dated.
    const rows = await runQuery(
      db,
      "index-health",
      Health,
      healthParams({ deny_window_days: "100000" }),
    );
    const deny = rows.find((r) => r.check_name === "hook-deny-invisible");
    expect(deny?.status).toBe("alert");
    expect(deny?.subject).toBe("6 denies recovered");
    expect(deny?.detail).toContain("git:block-default-branch-commit (5)");
    expect(deny?.detail).toContain("user:worktree (1)");
    // Subagent denies stay in the count (hook_events misses them too) but are broken
    // out, so a reader knows the total is not all main-thread friction.
    expect(deny?.detail).toContain("3 of the recovered denies were a subagent");
  });

  it("flags a kind that went silent beyond its own historical gap", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const silent = rows.filter((r) => r.check_name === "stream-silent");
    expect(silent.map((r) => r.subject)).toEqual(["attachment:health-quiet"]);
    expect(silent[0]?.status).toBe("alert");
    expect(silent[0]?.detail).toContain("worst historical gap 1");
  });

  it("classifies a silent kind with a live successor field as migrated, not dead", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const migrated = rows.filter((r) => r.check_name === "stream-migrated");
    expect(migrated.map((r) => r.subject)).toEqual(["system:api_error"]);
    expect(migrated[0]?.status).toBe("info");
    expect(migrated[0]?.detail).toContain("isApiErrorMessage");
    expect(migrated[0]?.detail).toContain("still arriving");
  });

  it("reports a kind first seen late in the corpus as new, not kinds as old as the index", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const fresh = rows.filter((r) => r.check_name === "stream-new");
    expect(fresh.map((r) => r.subject)).toEqual(["attachment:health-fresh"]);
    expect(fresh[0]?.status).toBe("info");
  });

  it("summarizes kinds whose rows carry no timestamp", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const nullTs = rows.find((r) => r.check_name === "null-timestamp-kinds");
    expect(nullTs?.status).toBe("info");
    // The detail names only the largest kinds, so assert its shape rather than a
    // ranking any new timestamp-less fixture would reshuffle.
    expect(nullTs?.detail).toMatch(/^\d+ rows carry no timestamp .* largest: [\w-]+ \(\d+\)/);
  });

  it("reports the corpus window per host and no disk gap when the glob matches", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const windows = rows.filter((r) => r.check_name === "corpus-window");
    expect(windows.map((r) => r.subject)).toEqual(["local"]);
    expect(rows.some((r) => r.check_name === "disk-not-indexed")).toBe(false);
    expect(rows.some((r) => r.check_name === "indexed-not-on-disk")).toBe(false);
  });

  it("alerts on disk files missing from the index", async () => {
    const extraDir = path.join(tmpDir, "extra-projects", "-Users-test-extra");
    mkdirSync(extraDir, { recursive: true });
    await Bun.write(
      path.join(extraDir, "unindexed.jsonl"),
      '{"type":"user","message":{"role":"user","content":"hi"},"sessionId":"extra","timestamp":"2024-02-01T00:00:00.000Z","uuid":"ex-1"}\n',
    );
    const rows = await runQuery(
      db,
      "index-health",
      Health,
      healthParams({ projects_glob: path.join(tmpDir, "extra-projects", "**", "*.jsonl") }),
    );
    const missing = rows.find((r) => r.check_name === "disk-not-indexed");
    expect(missing?.status).toBe("alert");
    expect(missing?.subject).toBe("1 files");
    expect(missing?.detail).toContain("unindexed.jsonl");
    // With the glob pointed away from the fixtures, every indexed file reads as deleted.
    expect(rows.find((r) => r.check_name === "indexed-not-on-disk")?.status).toBe("info");
  });

  it("alerts on an imported host whose newest record lags the corpus", async () => {
    const staleProjects = path.join(importsDir, "stale", "projects", "-Users-test-stale");
    mkdirSync(staleProjects, { recursive: true });
    await Bun.write(
      path.join(staleProjects, "old.jsonl"),
      '{"type":"user","message":{"role":"user","content":"old work"},"sessionId":"stale-session","timestamp":"2023-12-01T00:00:00.000Z","uuid":"st-1"}\n',
    );
    await Bun.write(
      path.join(importsDir, "stale", "manifest.json"),
      `${JSON.stringify({
        host: "stale",
        source: "stale:.claude/projects/",
        imported_at: "2024-01-01T00:00:00Z",
        policy: { block_egress: true },
      })}\n`,
    );
    await reindex();
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const staleness = rows.filter((r) => r.check_name === "host-staleness");
    // exactly the imported host: local never alerts, its remediation (re-sync)
    // does not apply
    expect(staleness.map((r) => r.subject)).toEqual(["stale"]);
    expect(staleness[0]?.status).toBe("alert");
    expect(staleness[0]?.detail).toContain("days behind the corpus");
  });
});

describe("frontmatter query", () => {
  it("parses name and description from a SKILL.md frontmatter", async () => {
    await loadExtensions(db);
    const skill = path.join(import.meta.dirname, "..", "SKILL.md");
    const rows = await runQuery(
      db,
      "frontmatter",
      z.object({ file_path: z.string(), name: z.string(), description: z.string() }),
      { frontmatter_glob: skill },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("claude-code:session");
    expect(rows[0]?.description).toContain("DuckDB index");
  });
});

describe("cost-rate macros", () => {
  it.each<[string, number, number]>([
    ["claude-fable-5", 10, 50],
    ["claude-mythos-1", 10, 50],
    ["claude-opus-5", 5, 25],
    ["claude-opus-5[1m]", 5, 25],
    ["claude-opus-4-8", 5, 25],
    ["claude-sonnet-5", 3, 15],
    ["claude-haiku-4", 1, 5],
    ["some-unknown-model", 5, 25],
  ])("rates %s at input %d / output %d per MTok", async (model, input, output) => {
    const [row] = await db.query(
      "SELECT model_input_rate($m) AS i, model_output_rate($m) AS o",
      z.object({ i: z.number(), o: z.number() }),
      { m: model },
    );
    expect(Number(row?.i)).toBe(input);
    expect(Number(row?.o)).toBe(output);
  });
});

describe("model_family macro", () => {
  it.each<[string, string]>([
    ["claude-fable-5", "fable"],
    ["claude-mythos-1", "fable"],
    ["claude-opus-5", "opus"],
    ["claude-opus-5[1m]", "opus"],
    ["claude-opus-4-8", "opus"],
    ["opus", "opus"],
    ["claude-sonnet-5", "sonnet"],
    ["claude-haiku-4", "haiku"],
    ["some-unknown-model", "other"],
  ])("collapses %s to %s", async (model, family) => {
    const [row] = await db.query("SELECT model_family($m) AS f", z.object({ f: z.string() }), {
      m: model,
    });
    expect(row?.f).toBe(family);
  });

  it("returns NULL for a NULL model", async () => {
    const [row] = await db.query(
      "SELECT model_family(NULL) AS f",
      z.object({ f: z.string().nullable() }),
    );
    expect(row?.f).toBeNull();
  });
});

describe("message_usage cost columns and usage queries", () => {
  const OPUS = "claude-opus-4-8";

  // One assistant message with known usage. The cost math the queries apply:
  // input*in_rate + cache_5m*1.25*in + cache_1h*2*in + cache_read*0.1*in + output*out_rate,
  // all per MTok. For opus (in 5, out 25) with the values below that is
  // (1000*5 + 2000*1.25*5 + 3000*2*5 + 10000*0.1*5 + 2000*25) / 1e6 = 0.1025 -> 0.10.
  function assistantLine(opts: {
    session: string;
    id: string;
    ts: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    c1h: number;
    c5m: number;
  }): string {
    return JSON.stringify({
      type: "assistant",
      sessionId: opts.session,
      cwd: "/Users/test/usage-proj",
      timestamp: `${opts.ts}.000Z`,
      uuid: opts.id,
      message: {
        id: opts.id,
        role: "assistant",
        model: OPUS,
        content: [{ type: "text", text: "x" }],
        usage: {
          input_tokens: opts.input,
          output_tokens: opts.output,
          cache_read_input_tokens: opts.cacheRead,
          cache_creation_input_tokens: opts.cacheWrite,
          cache_creation: {
            ephemeral_1h_input_tokens: opts.c1h,
            ephemeral_5m_input_tokens: opts.c5m,
          },
        },
      },
    });
  }

  async function insertUsage(session: string) {
    const rows = [
      {
        id: `${session}-a`,
        ts: "2026-03-01T10:00:00",
        sidechain: false,
        input: 1000,
        output: 2000,
        cacheRead: 10000,
        cacheWrite: 5000,
        c1h: 3000,
        c5m: 2000,
      },
      // A sidechain message with no usage: it lifts msgs and sidechain_share but adds
      // nothing to the bucket cost, keeping the expected total exact.
      {
        id: `${session}-b`,
        ts: "2026-03-01T10:05:00",
        sidechain: true,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        c1h: 0,
        c5m: 0,
      },
    ];
    let line = 1;
    for (const r of rows) {
      // oxlint-disable-next-line no-await-in-loop -- rows insert in fixture order on one connection so source_line stays deterministic.
      await db.run(
        `INSERT INTO raw
           (host, session_id, type, project_path, is_sidechain, timestamp,
            input_tokens, output_tokens, source_file, source_line, data)
         VALUES ('local', $session, 'assistant', '/Users/test/usage-proj', $sidechain,
                 $ts::TIMESTAMP, $input, $output, $source_file, $source_line, $line::JSON)`,
        {
          session,
          sidechain: r.sidechain ? "true" : "false",
          ts: r.ts,
          input: String(r.input),
          output: String(r.output),
          source_file: `/Users/test/usage-proj/${session}.jsonl`,
          source_line: String(line++),
          line: assistantLine({ session, ...r }),
        },
      );
    }
    await db.run("DELETE FROM meta");
    await rebuildViews(db);
  }

  it("exposes the TTL split and sidechain/source_file columns on message_usage", async () => {
    await insertUsage("usage-cols-session");
    const [row] = await db.query(
      "SELECT cache_1h_tokens, cache_5m_tokens, is_sidechain, source_file FROM message_usage WHERE message_id = 'usage-cols-session-a'",
      z.object({
        cache_1h_tokens: z.bigint(),
        cache_5m_tokens: z.bigint(),
        is_sidechain: z.boolean(),
        source_file: z.string(),
      }),
    );
    expect(Number(row?.cache_1h_tokens)).toBe(3000);
    expect(Number(row?.cache_5m_tokens)).toBe(2000);
    expect(row?.is_sidechain).toBe(false);
    expect(row?.source_file).toContain("usage-cols-session.jsonl");
  });

  it("usage-timeline buckets the session with exact cost and shape signals", async () => {
    await insertUsage("usage-timeline-session");
    const rows = await runQuery(
      db,
      "usage-timeline",
      z.object({
        msgs: z.bigint(),
        cost_usd_est: z.number(),
        cache_miss_ratio: z.number(),
        max_context_tokens: z.bigint(),
        sidechain_share: z.number(),
        top_model: z.string(),
      }),
      {
        session: "usage-timeline-session",
        host: null,
        bucket_minutes: null,
      },
    );
    expect(rows).toHaveLength(1);
    const [b] = rows;
    expect(Number(b?.msgs)).toBe(2);
    expect(b?.cost_usd_est).toBe(0.1);
    expect(b?.cache_miss_ratio).toBe(0.33);
    expect(Number(b?.max_context_tokens)).toBe(16000);
    expect(b?.sidechain_share).toBe(0.5);
    expect(b?.top_model).toBe(OPUS);
  });

  it("usage-spikes ranks the burn window with its repo", async () => {
    await insertUsage("usage-spikes-session");
    const rows = await runQuery(
      db,
      "usage-spikes",
      z.object({
        session_id: z.string(),
        repo: z.string().nullable(),
        msgs: z.bigint(),
        cost_usd_est: z.number(),
      }),
      {
        after_date: null,
        before_date: null,
        project: null,
        host: null,
        bucket_minutes: null,
        limit: null,
      },
    );
    const mine = rows.find((r) => r.session_id === "usage-spikes-session");
    expect(mine).toBeDefined();
    expect(mine?.repo).toBe("usage-proj");
    expect(Number(mine?.msgs)).toBe(2);
    expect(mine?.cost_usd_est).toBe(0.1);
  });

  it("top-sessions ranks the session by cost with host and repo", async () => {
    await insertUsage("top-sessions-session");
    const rows = await runQuery(
      db,
      "top-sessions",
      z.object({
        session_id: z.string(),
        host: z.string(),
        repo: z.string().nullable(),
        msgs: z.bigint(),
        cost_usd_est: z.number(),
      }),
      {
        after_date: null,
        host: null,
      },
    );
    const mine = rows.find((r) => r.session_id === "top-sessions-session");
    expect(mine).toBeDefined();
    expect(mine?.host).toBe("local");
    expect(mine?.repo).toBe("usage-proj");
    expect(Number(mine?.msgs)).toBe(2);
    expect(mine?.cost_usd_est).toBe(0.1);
  });
});

describe("field-drift query", () => {
  const DriftRow = z.object({
    field: z.string(),
    recent_rows: z.bigint(),
    first_seen: z.string(),
    last_seen: z.string(),
  });

  // The fixture corpus stands in for the real one: `toolDenialKind` appears only on and
  // after 2024-01-20, `promptSource` straddles that date. `cutoff_date` pins the boundary
  // so the case does not decay as wall-clock time moves past `new_days`.
  function driftParams(overrides: Record<string, string | null> = {}) {
    return {
      new_days: null,
      cutoff_date: "2024-01-20",
      min_rows: "1",
      sample_pct: "100",
      host: null,
      ...overrides,
    };
  }

  it("reports a field that arrived on an existing record kind", async () => {
    const rows = await runQuery(db, "field-drift", DriftRow, driftParams());
    const denial = rows.find((r) => r.field === "user:$.toolDenialKind");
    expect(denial).toBeDefined();
    expect(Number(denial?.recent_rows)).toBe(4);
    expect(denial?.first_seen).toBe("2024-01-20");
  });

  it("stays silent on a field that predates the cutoff", async () => {
    const rows = await runQuery(db, "field-drift", DriftRow, driftParams());
    expect(rows.map((r) => r.field)).not.toContain("user:$.promptSource");
  });

  it("honors min_rows", async () => {
    const rows = await runQuery(db, "field-drift", DriftRow, driftParams({ min_rows: "500" }));
    expect(rows).toEqual([]);
  });

  it("samples deterministically, so a rerun walks the same rows", async () => {
    const params = driftParams({ sample_pct: "50" });
    const first = await runQuery(db, "field-drift", DriftRow, params);
    const second = await runQuery(db, "field-drift", DriftRow, params);
    expect(first).toEqual(second);
  });
});

describe("schema map", () => {
  it("stays in step with views.sql, so the injected fallback is never stale", async () => {
    const rows = await db.query(
      `
      SELECT table_name, list(column_name ORDER BY ordinal_position) AS cols
      FROM information_schema.columns
      WHERE table_name IN (${SURFACES.map((s) => `'${s}'`).join(", ")})
      GROUP BY table_name
    `,
      SurfaceColumns,
    );
    const live = renderMap(rows);

    // Regenerate with UPDATE_SCHEMA_MAP=1 after changing a projected column.
    if (process.env.UPDATE_SCHEMA_MAP !== undefined) await Bun.write(FALLBACK_PATH, `${live}\n`);

    expect(live).toBe((await Bun.file(FALLBACK_PATH).text()).trim());

    // An index missing a surface must reach the fallback rather than inject a map that
    // silently omits it.
    expect(() => renderMap(rows.filter((row) => row.table_name !== "content_items"))).toThrow(
      /content_items/,
    );
  });

  it("falls back to the committed map when the index cannot be reached", async () => {
    const dataDir = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = path.join(tmpDir, "absent");
    try {
      const lines = (await schemaMap()).split("\n");
      expect(lines.map((line) => line.split(":")[0])).toEqual([...SURFACES]);
    } finally {
      if (dataDir === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = dataDir;
    }
  });
});
