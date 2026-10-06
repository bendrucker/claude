import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type Database, ensureIndex, ensureSchema, getDb, runQuery } from "./db";
import { MiB, overCap } from "./retention";
import { type Source, parseDebugLog, prune, syncSource } from "./telemetry";

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");

let db: Database;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-telemetry-"));
  db = await getDb(tmpDir);
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("parseDebugLog", () => {
  it.each([
    [
      "2026-09-02T01:52:13.631Z [INFO] [Stall] classifier_request_finished reqId=r1 tool=Bash stage=xml_s1 outcome=ok durationMs=1678",
      {
        ts: "2026-09-02T01:52:13.631Z",
        event: "classifier_request_finished",
        fields: { reqId: "r1", tool: "Bash", stage: "xml_s1", outcome: "ok", durationMs: "1678" },
      },
    ],
    [
      "2026-09-02T01:52:11.953Z [INFO] [Stall] classifier_request_started reqId=r1 tool=Bash model=claude-sonnet-5[1m] stage=xml_s1",
      {
        ts: "2026-09-02T01:52:11.953Z",
        event: "classifier_request_started",
        fields: { reqId: "r1", tool: "Bash", model: "claude-sonnet-5[1m]", stage: "xml_s1" },
      },
    ],
    [
      "2026-09-02T01:52:02.640Z [DEBUG] Ignoring dangerous permission Bash(python3 *) from ../.claude/settings.local.json (bypasses classifier)",
      {
        ts: "2026-09-02T01:52:02.640Z",
        event: "dangerous_rule_ignored",
        fields: { rule: "Bash(python3 *)", source: "../.claude/settings.local.json" },
      },
    ],
  ])("parses %s", (line, event) => {
    expect(parseDebugLog(line)).toEqual([{ line: 1, ...event }]);
  });

  it("skips every other line and numbers from one", () => {
    const text = [
      "2026-09-02T01:52:02.000Z [DEBUG] MDM settings load completed in 0ms",
      "continuation of a multi-line entry [Stall] classifier_request_started",
      "2026-09-02T01:52:03.000Z [INFO] [Stall] tool_dispatch_start tool=Read toolUseId=t1 permissionDecisionMs=0",
      "",
    ].join("\n");
    expect(parseDebugLog(text).map((e) => [e.line, e.event])).toEqual([[3, "tool_dispatch_start"]]);
  });
});

const Row = z.object({
  section: z.string(),
  week: z.date().nullable(),
  dim1: z.string().nullable(),
  dim2: z.string().nullable(),
  calls: z.bigint(),
  p50_ms: z.number().nullable(),
  p90_ms: z.number().nullable(),
  max_ms: z.number().nullable(),
});

describe("classifier query", () => {
  it("reports each section over the fixtures", async () => {
    await ensureIndex(db, { projectsDir: fixturesDir, importsDir: join(tmpDir, "imports") });
    const rows = await runQuery(db, "classifier", Row, {
      after_date: null,
      before_date: null,
      host: null,
    });
    const lines = rows.map((r) =>
      [r.section, r.dim1, r.dim2, r.calls, r.p50_ms, r.p90_ms, r.max_ms].join(" | "),
    );
    expect(lines).toMatchInlineSnapshot(`
      [
        "classifier-request | xml_s1 | ok | 2 | 2750 | 3750 | 4000",
        "classifier-request | xml_s1 | error | 1 | 30000 | 30000 | 30000",
        "classifier-request | xml_s2 | ok | 1 | 6000 | 6000 | 6000",
        "dropped-allow-rule | Bash(env) | .claude/settings.local.json | 1 |  |  | ",
        "dropped-allow-rule | Bash(python3 *) | .claude/settings.local.json | 1 |  |  | ",
        "permission-decision | Bash |  | 1 | 1510 | 1510 | 1510",
        "permission-decision | Read |  | 1 | 0 | 0 | 0",
        "verdict | allow | ok | 1 | 12 | 12 | 12",
        "verdict | ask | automode-blocked | 1 | 10100 | 10100 | 10100",
        "verdict | ask | automode-unavailable | 1 | 30500 | 30500 | 30500",
        "verdict | ask | user-rejected | 1 | 1600 | 1600 | 1600",
      ]
    `);
  });
});

describe("telemetry ingest", () => {
  const Count = z.object({ n: z.bigint() });
  const count = async (sql: string) => Number((await db.query(sql, Count))[0]?.n);

  function layout() {
    const projectsDir = join(tmpDir, "claude", "projects");
    const debugDir = join(tmpDir, "claude", "debug");
    const recordsDir = join(tmpDir, "claude", "classifier-telemetry", "s1");
    const modEventsDir = join(tmpDir, "claude", "mod-events");
    for (const dir of [projectsDir, debugDir, recordsDir, join(modEventsDir, "s1")]) {
      mkdirSync(dir, { recursive: true });
    }
    const reindex = () => ensureIndex(db, { projectsDir, importsDir: join(tmpDir, "imports") });
    return { debugDir, recordsDir, modEventsDir, reindex };
  }

  const stall = (ms: number) =>
    `2026-09-02T01:52:13.631Z [INFO] [Stall] classifier_request_finished reqId=r${ms} tool=Bash stage=xml_s1 outcome=ok durationMs=${ms}\n`;
  const record = (id: string) =>
    JSON.stringify({ session_id: "s1", tool_use_id: id, tool: "Bash", decision: "ask" });

  it("follows a debug log as it grows, and keeps its rows once it is deleted", async () => {
    const { debugDir, reindex } = layout();
    const log = join(debugDir, "s1.txt");

    await Bun.write(log, stall(1));
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM debug_events WHERE session_id = 's1'")).toBe(1);

    await Bun.write(log, stall(1) + stall(2));
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM debug_events")).toBe(2);

    await rm(log);
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM debug_events")).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM telemetry_files WHERE source = 'debug'")).toBe(0);
  });

  it("indexes each mod-events chunk as it grows", async () => {
    const { modEventsDir, reindex } = layout();
    const chunk = join(modEventsDir, "s1", "herdr.1000.0.jsonl");
    const line = (event: string, ok: boolean) =>
      `${JSON.stringify({ ts: 1_791_304_406_845, session: "s1", mod: "herdr", event, ok, ms: 12, detail: { exitCode: ok ? 0 : 1 } })}\n`;

    await Bun.write(chunk, line("session.start", true));
    await reindex();
    await Bun.write(chunk, `${line("session.start", true)}${line("herdr.call", false)}{"ts":1,`);
    await reindex();

    const rows = await db.query(
      "SELECT session_id, mod, event, ok, ms, detail->>'exitCode' AS exit_code, source_file FROM mod_events ORDER BY event",
      z.object({
        session_id: z.string(),
        mod: z.string(),
        event: z.string(),
        ok: z.boolean(),
        ms: z.bigint(),
        exit_code: z.string(),
        source_file: z.string(),
      }),
    );
    expect(rows).toEqual([
      {
        session_id: "s1",
        mod: "herdr",
        event: "herdr.call",
        ok: false,
        ms: 12n,
        exit_code: "1",
        source_file: chunk,
      },
      {
        session_id: "s1",
        mod: "herdr",
        event: "session.start",
        ok: true,
        ms: 12n,
        exit_code: "0",
        source_file: chunk,
      },
    ]);
  });

  it("picks up records added to a session directory", async () => {
    const { recordsDir, reindex } = layout();

    await Bun.write(join(recordsDir, "t1.json"), record("t1"));
    await reindex();
    await Bun.write(join(recordsDir, "t2.json"), record("t2"));
    await reindex();

    const rows = await db.query(
      "SELECT tool_use_id, source_dir FROM tool_verdicts ORDER BY tool_use_id",
      z.object({ tool_use_id: z.string(), source_dir: z.string() }),
    );
    expect(rows).toEqual([
      { tool_use_id: "t1", source_dir: recordsDir },
      { tool_use_id: "t2", source_dir: recordsDir },
    ]);
  });

  it("rereads a record first indexed mid-write", async () => {
    const { recordsDir, reindex } = layout();
    const path = join(recordsDir, "t1.json");

    await Bun.write(path, record("t1").slice(0, 10));
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM tool_verdicts")).toBe(0);

    await Bun.write(path, record("t1"));
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM tool_verdicts")).toBe(1);
  });

  it("keeps rows when the telemetry directories are missing", async () => {
    const { debugDir, reindex } = layout();
    await Bun.write(join(debugDir, "s1.txt"), stall(1));
    await reindex();

    await rm(debugDir, { recursive: true });
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM debug_events")).toBe(1);
  });
});

describe("syncSource", () => {
  function sourceOf(root: string, beforeFailing: (path: string) => Promise<void>): Source {
    return {
      name: "stub",
      root,
      scan: (entries) =>
        entries.map((entry) => ({ path: join(root, entry.name), mtime: 1, size: 1 })),
      async import(_db, file) {
        await beforeFailing(file.path);
        throw new Error("import failed");
      },
      remove: () => Promise.resolve(),
    };
  }

  it.each([
    { name: "skips a file deleted after the scan", vanishes: true, outcome: "1 changed" },
    { name: "rethrows when the file is still there", vanishes: false, outcome: "import failed" },
  ])("$name", async ({ vanishes, outcome }) => {
    await ensureSchema(db);
    const root = join(tmpDir, "stub");
    mkdirSync(root);
    await Bun.write(join(root, "a.txt"), "x");
    const source = sourceOf(root, (path) => (vanishes ? rm(path) : Promise.resolve()));

    const settled = await syncSource(db, source).then(
      (changed) => `${changed} changed`,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(settled).toBe(outcome);
    const Count = z.object({ n: z.bigint() });
    const [row] = await db.query("SELECT COUNT(*) AS n FROM telemetry_files", Count);
    expect(Number(row?.n)).toBe(0);
  });
});

describe("mods query", () => {
  it("reports each mod's events with the surface on the heartbeat", async () => {
    const projectsDir = join(tmpDir, "claude", "projects");
    const sessionDir = join(tmpDir, "claude", "mod-events", "s1");
    for (const dir of [projectsDir, sessionDir]) mkdirSync(dir, { recursive: true });
    const jsonl = (...events: object[]) => events.map((e) => `${JSON.stringify(e)}\n`).join("");
    const at = { ts: 1_791_304_406_845, session: "s1" };
    await Bun.write(
      join(sessionDir, "mod-events.1.0.jsonl"),
      jsonl({
        ...at,
        mod: "mod-events",
        event: "session.start",
        ok: true,
        ms: null,
        detail: { surface: "mosh" },
      }),
    );
    await Bun.write(
      join(sessionDir, "herdr.1.0.jsonl"),
      jsonl(
        { ...at, mod: "herdr", event: "session.start", ok: true, ms: null, detail: {} },
        { ...at, mod: "herdr", event: "herdr.call", ok: true, ms: 10, detail: {} },
        { ...at, mod: "herdr", event: "herdr.call", ok: false, ms: 30, detail: {} },
      ),
    );
    await ensureIndex(db, { projectsDir, importsDir: join(tmpDir, "imports") });

    const rows = await runQuery(
      db,
      "mods",
      z.object({
        mod: z.string(),
        event: z.string(),
        sessions: z.bigint(),
        events: z.bigint(),
        failed: z.bigint(),
        p50_ms: z.number().nullable(),
        surfaces: z.string().nullable(),
      }),
      { after_date: null, before_date: null, host: null },
    );
    expect(
      rows.map((r) =>
        [r.mod, r.event, r.sessions, r.events, r.failed, r.p50_ms, r.surfaces].join(" | "),
      ),
    ).toMatchInlineSnapshot(`
      [
        "herdr | herdr.call | 1 | 2 | 1 | 20 | ",
        "herdr | session.start | 1 | 1 | 0 |  | ",
        "mod-events | session.start | 1 | 1 | 0 |  | {"mosh":1}",
      ]
    `);
  });
});

describe("overCap", () => {
  const file = (name: string, mtime: number, size: number) => ({ path: name, mtime, size });

  it.each([
    {
      name: "nothing under the cap",
      files: [file("a", 1, 4), file("b", 2, 4)],
      cap: 8,
      doomed: [],
    },
    {
      name: "the oldest first",
      files: [file("new", 3, 4), file("old", 1, 4), file("mid", 2, 4)],
      cap: 8,
      doomed: ["old"],
    },
    {
      name: "as many as it takes",
      files: [file("a", 1, 4), file("b", 2, 4), file("c", 3, 4)],
      cap: 3,
      doomed: ["a", "b", "c"],
    },
    {
      name: "a big old file alone",
      files: [file("big", 1, 10), file("small", 2, 1)],
      cap: 5,
      doomed: ["big"],
    },
    {
      name: "past one it may not delete",
      files: [file("pinned", 1, 4), file("a", 2, 4), file("b", 3, 4)],
      cap: 4,
      doomed: ["a", "b"],
    },
  ])("deletes $name", ({ files, cap, doomed }) => {
    expect(overCap(files, cap, (f) => f.path !== "pinned").map((f) => f.path)).toEqual(doomed);
  });
});

describe("prune", () => {
  const AGES: Record<string, number> = { unindexed: 0, old: 1, mid: 2, new: 3 };

  function sourceOf(root: string, cap: number): Source {
    return {
      name: "capped",
      root,
      cap,
      scan: (entries) =>
        entries.map((entry) => ({
          path: join(root, entry.name),
          mtime: AGES[entry.name] ?? 0,
          size: Bun.file(join(root, entry.name)).size,
        })),
      import: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
  }

  it("deletes the oldest indexed files past the cap and leaves unindexed ones", async () => {
    await ensureSchema(db);
    const root = join(tmpDir, "capped");
    mkdirSync(root);
    const source = sourceOf(root, 2 * MiB + 1);
    await Promise.all(
      ["old", "mid", "new"].map((name) => Bun.write(join(root, name), "x".repeat(MiB))),
    );
    await syncSource(db, source);
    await Bun.write(join(root, "unindexed"), "y");

    expect(await prune(db, source)).toBe(1);
    expect(readdirSync(root).toSorted()).toEqual(["mid", "new", "unindexed"]);
    const Path = z.object({ path: z.string() });
    expect(await db.query("SELECT path FROM telemetry_files ORDER BY path", Path)).toEqual([
      { path: join(root, "mid") },
      { path: join(root, "new") },
    ]);
  });
});
