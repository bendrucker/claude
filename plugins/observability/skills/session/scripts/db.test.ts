import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { runQuery } from "./db";
import { db, filterParams, queryParams, reindex, tmpDir, useFixtureIndex } from "./db.fixture";
import { FALLBACK_PATH, renderMap, schemaMap, SurfaceColumns, SURFACES } from "./schema";

useFixtureIndex();

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

describe("tool-failure-rates query", () => {
  const FailureRow = z.object({
    tool_name: z.string(),
    calls: z.bigint(),
    failures: z.bigint(),
    failure_pct: z.number(),
    signature: z.string(),
    errors: z.bigint(),
    sessions: z.bigint(),
    agent_threads: z.bigint(),
    first_seen: z.date(),
    last_seen: z.date(),
  });

  async function rates(tool: string, overrides: Record<string, string | null> = {}) {
    const rows = await runQuery(
      db,
      "tool-failure-rates",
      FailureRow,
      filterParams({ min_calls: "1", limit: null, ...overrides }),
    );
    return rows.filter((r) => r.tool_name === tool);
  }

  it("rates failures over calls that ran, leaving denials out of both", async () => {
    const [row] = await rates("EnterWorktree");
    expect(row).toMatchObject({ calls: 5n, failures: 4n });
    expect(row?.failure_pct).toBe(80);
  });

  it("leaves out a plan redirect whose rejection carries no denial kind", async () => {
    expect(await rates("ExitPlanMode")).toEqual([]);
  });

  it("collapses paths, ids, and the tool_use_error wrapper into one signature", async () => {
    const rows = await rates("EnterWorktree");
    expect(rows.map((r) => r.signature)).toEqual([
      "Cannot enter worktree: <path> does not exist (agent <id>)",
      "Already in a worktree session.",
    ]);
  });

  it("counts a subagent as its own thread and dates each signature", async () => {
    const [row] = await rates("EnterWorktree");
    expect(row).toMatchObject({ errors: 3n, sessions: 1n, agent_threads: 2n });
    expect(row?.first_seen.toISOString()).toBe("2024-01-22T10:03:00.000Z");
    expect(row?.last_seen.toISOString()).toBe("2024-01-22T10:10:01.000Z");
  });

  it("drops a tool below the call floor and caps signatures per tool", async () => {
    expect(await rates("Glob")).toHaveLength(1);
    expect(await rates("Glob", { min_calls: "2" })).toEqual([]);
    expect(await rates("EnterWorktree", { limit: "1" })).toHaveLength(1);
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

describe("bare-refs query", () => {
  const Row = z.object({
    bucket: z.string(),
    ref_messages: z.bigint(),
    bare_messages: z.bigint(),
    linked_messages: z.bigint(),
    bare_pct: z.number(),
  });

  it.each([
    ["week", "2024-01-15"],
    ["model", "claude-opus-4-7-20260101"],
  ])("splits bare from linked refs per %s", async (per, bucket) => {
    const rows = await runQuery(db, "bare-refs", Row, filterParams({ per, project: "refs" }));
    // the fixture's fourth message (a list number, a standards ID, inline code, a plan
    // label) and the user's own #77 both fall outside the count
    expect(rows).toEqual([
      { bucket, ref_messages: 6n, bare_messages: 4n, linked_messages: 3n, bare_pct: 66.7 },
    ]);
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

  it.each<{ name: string; toolUseId: string; reason: string; command: string | null }>([
    {
      name: "a string-encoded payload without a command",
      toolUseId: "hk-stop-1",
      reason: "Biome check failed. Auto-fix was attempted but issues remain.",
      command: null,
    },
    {
      name: "an object payload naming its command",
      toolUseId: "hk-stop-3",
      reason: "comment-density: trim the comments before stopping.",
      // oxlint-disable-next-line no-template-curly-in-string -- the fixture records the hook command unexpanded.
      command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/density.ts",
    },
  ])("unwraps a hook_blocking_error from $name", async ({ toolUseId, reason, command }) => {
    const [row] = await db.query(
      `SELECT reason, command, blocked FROM hook_events WHERE kind = 'hook_blocking_error' AND tool_use_id = '${toolUseId}'`,
      z.object({ reason: z.string(), command: z.string().nullable(), blocked: z.boolean() }),
    );
    expect(row).toEqual({ reason, command, blocked: true });
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

  it("recovers a deny whose reason carries the harness's PreToolUse:<Tool> hook error: prefix", async () => {
    const rows = await db.query(
      "SELECT hook_name, reason FROM hook_denies WHERE tool_use_id = 'hk-deny-3'",
      z.object({ hook_name: z.string(), reason: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hook_name).toBe("pull-request:validate-body");
    expect(rows[0]?.reason).toStartWith("Fix the PR body before retrying");
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
      "sessions: handed-off": 2,
      "sessions: abandoned-with-edits": 3,
      "sessions: no-artifact": 19,
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
      "sessions: ongoing": 25,
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
    process.env.CLAUDE_PLUGIN_DATA = join(tmpDir, "absent");
    try {
      const lines = (await schemaMap()).split("\n");
      expect(lines.map((line) => line.split(":")[0])).toEqual([...SURFACES]);
    } finally {
      if (dataDir === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = dataDir;
    }
  });
});
