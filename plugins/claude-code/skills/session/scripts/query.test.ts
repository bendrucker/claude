import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { type Database, ensureIndex, getDb } from "./db";
import {
  cliAdapter,
  nodeAdapter,
  type QueryParams,
  type QueryProcess,
  renderSetVariables,
  runQuery,
  type SpawnDuckdb,
} from "./query";

describe("renderSetVariables", () => {
  test.each([
    ["a plain string", { project: "claude" }, `SET VARIABLE "project" = 'claude';\n`],
    ["a string with quotes", { query: "it's" }, `SET VARIABLE "query" = 'it''s';\n`],
    ["a number", { limit: 10 }, `SET VARIABLE "limit" = 10;\n`],
    ["null", { host: null }, `SET VARIABLE "host" = NULL;\n`],
    ["undefined, which is left unset", { host: undefined }, ""],
    ["no params at all", {}, ""],
    [
      "every param in order",
      { after_date: "2026-01-01", host: undefined, limit: 5 },
      `SET VARIABLE "after_date" = '2026-01-01';\nSET VARIABLE "limit" = 5;\n`,
    ],
  ] satisfies [string, QueryParams, string][])("renders %s", (_name, params, expected) => {
    expect(renderSetVariables(params)).toBe(expected);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects %p", (value) => {
    expect(() => renderSetVariables({ bucket_minutes: value })).toThrow("non-finite");
  });
});

describe("node adapter", () => {
  const Variable = z.object({ v: z.string().nullable() });
  const VARIABLE_SQL = "SELECT getvariable('v')::VARCHAR AS v";

  let db: Database;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "session-query-"));
    const importsDir = path.join(tmpDir, "imports");
    mkdirSync(importsDir, { recursive: true });
    db = await getDb(tmpDir);
    await ensureIndex(db, {
      projectsDir: path.join(import.meta.dirname, "..", "fixtures", "sessions"),
      importsDir,
    });
  }, 60_000);

  afterAll(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  test.each([
    ["a plain string", "claude", "claude"],
    ["a string with quotes", "it's", "it's"],
    ["a number", 42, "42"],
    ["null", null, null],
  ] satisfies [string, string | number | null, string | null][])(
    "binds %s",
    async (_name, value, expected) => {
      const rows = await runQuery(nodeAdapter(db), { sql: VARIABLE_SQL }, Variable, { v: value });
      expect(rows).toEqual([{ v: expected }]);
    },
  );

  it("leaves an undefined param unset", async () => {
    const rows = await runQuery(
      nodeAdapter(db),
      { sql: "SELECT getvariable('never_set')::VARCHAR AS v" },
      Variable,
      { never_set: undefined },
    );
    expect(rows).toEqual([{ v: null }]);
  });

  it("runs a named query from resources/queries", async () => {
    const rows = await runQuery(
      nodeAdapter(db),
      { name: "search" },
      z.object({ session_id: z.string() }),
      {
        query: "error",
        after_date: null,
        before_date: null,
        project: null,
        host: null,
        limit: 10,
      },
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("cli adapter", () => {
  const Row = z.object({ n: z.number() });

  function stream(text: string): ReadableStream<Uint8Array> {
    return new Response(text).body!;
  }

  function stubSpawn(
    result: { stdout?: string; stderr?: string; code?: number },
    seen: { stdin?: string; command?: string[] } = {},
  ): SpawnDuckdb {
    return (command, options) => {
      seen.command = command;
      seen.stdin = options.stdin.toString();
      return {
        stdout: stream(result.stdout ?? ""),
        stderr: stream(result.stderr ?? ""),
        exited: Promise.resolve(result.code ?? 0),
      };
    };
  }

  it("opens the database read-only and prepends the bound variables", async () => {
    const seen: { stdin?: string; command?: string[] } = {};
    const adapter = cliAdapter("/tmp/session.duckdb", {
      spawn: stubSpawn({ stdout: '[{"n":1}]' }, seen),
    });

    const rows = await runQuery(adapter, { sql: "SELECT 1 AS n" }, Row, { host: "work", limit: 5 });

    expect(rows).toEqual([{ n: 1 }]);
    expect(seen.command).toEqual(["duckdb", "-readonly", "-json", "/tmp/session.duckdb"]);
    expect(seen.stdin).toBe(
      `SET VARIABLE "host" = 'work';\nSET VARIABLE "limit" = 5;\nSELECT 1 AS n`,
    );
  });

  it("decodes empty output as no rows", async () => {
    const adapter = cliAdapter("/tmp/session.duckdb", { spawn: stubSpawn({ stdout: "\n" }) });
    expect(await runQuery(adapter, { sql: "SELECT 1" }, Row)).toEqual([]);
  });

  function failure(rows: Promise<unknown[]>): Promise<string> {
    return rows.then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  }

  test.each([
    [
      "reports stderr on a non-zero exit",
      "Parser Error: syntax error",
      "Parser Error: syntax error",
    ],
    ["falls back to the exit code when stderr is empty", "  ", "duckdb exited 1"],
  ])("%s", async (_name, stderr, message) => {
    const adapter = cliAdapter("/tmp/session.duckdb", { spawn: stubSpawn({ stderr, code: 1 }) });
    expect(await failure(runQuery(adapter, { sql: "SELECT 1" }, Row))).toBe(message);
  });

  it("reports a timeout rather than the kill signal", async () => {
    const hangs: SpawnDuckdb = (_command, options): QueryProcess => ({
      stdout: stream(""),
      stderr: stream(""),
      exited: once(options.signal, "abort").then(() => 143),
    });
    const adapter = cliAdapter("/tmp/session.duckdb", { timeoutMs: 10, spawn: hangs });

    expect(await failure(runQuery(adapter, { sql: "SELECT 1" }, Row))).toBe(
      "duckdb timed out after 10ms",
    );
  });
});
