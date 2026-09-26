import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type Database, ensureIndex, getDb, runQuery } from "./db";
import { parseDebugLog } from "./telemetry";

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
    for (const dir of [projectsDir, debugDir, recordsDir]) mkdirSync(dir, { recursive: true });
    const reindex = () => ensureIndex(db, { projectsDir, importsDir: join(tmpDir, "imports") });
    return { debugDir, recordsDir, reindex };
  }

  const stall = (ms: number) =>
    `2026-09-02T01:52:13.631Z [INFO] [Stall] classifier_request_finished reqId=r${ms} tool=Bash stage=xml_s1 outcome=ok durationMs=${ms}\n`;
  const record = (id: string) =>
    JSON.stringify({ session_id: "s1", tool_use_id: id, tool: "Bash", decision: "ask" });

  it("follows a debug log as it grows and is deleted", async () => {
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
    expect(await count("SELECT COUNT(*) AS n FROM debug_events")).toBe(0);
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

  it("keeps rows when the telemetry directories are missing", async () => {
    const { debugDir, reindex } = layout();
    await Bun.write(join(debugDir, "s1.txt"), stall(1));
    await reindex();

    await rm(debugDir, { recursive: true });
    await reindex();
    expect(await count("SELECT COUNT(*) AS n FROM debug_events")).toBe(1);
  });
});
