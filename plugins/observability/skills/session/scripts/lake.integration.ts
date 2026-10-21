import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import { ensureIndex, getDb, sessionDbPath } from "./db";
import { type LakeOptions, materializedViews, publish, viewStatements } from "./lake";

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");
const viewsSql = join(import.meta.dirname, "..", "resources", "views.sql");

let dir: string;
let projects: string;
let imports: string;
let options: LakeOptions;

async function refresh() {
  const db = await getDb(dir);
  try {
    await ensureIndex(db, { projectsDir: projects, importsDir: imports });
  } finally {
    db.close();
  }
}

// Rows the lake holds that the local index does not, and the reverse, per table.
async function drift(tables: string[]): Promise<Record<string, number>> {
  const instance = await DuckDBInstance.create(":memory:");
  const c = await instance.connect();
  try {
    await c.run("LOAD ducklake");
    await c.run(`ATTACH '${options.index}' AS idx (READ_ONLY)`);
    await c.run(`ATTACH 'ducklake:${join(options.url, "catalog.ducklake")}' AS lake (READ_ONLY)`);
    const sql = tables
      .map((t) => {
        const local = `SELECT * FROM idx.${t} WHERE host = 'local'`;
        return `SELECT '${t}' AS t,
          (SELECT count(*) FROM (${local} EXCEPT ALL FROM lake.${t}))
            + (SELECT count(*) FROM (FROM lake.${t} EXCEPT ALL ${local})) AS n`;
      })
      .join(" UNION ALL ");
    const rows = z
      .array(z.object({ t: z.string(), n: z.union([z.bigint(), z.number()]) }))
      .parse((await c.runAndReadAll(sql)).getRowObjectsJS());
    return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
  } finally {
    c.closeSync();
    instance.closeSync();
  }
}

const tables = async () => [
  "raw",
  "content_items",
  "search_items",
  "file_fields",
  ...materializedViews(viewStatements(await Bun.file(viewsSql).text())),
];
const clean = (ts: string[]) => Object.fromEntries(ts.map((t) => [t, 0]));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "session-lake-"));
  projects = join(dir, "projects");
  imports = join(dir, "imports");
  await $`cp -R ${fixturesDir}/. ${projects}`.quiet();
  // An imported host holding a copy of the local corpus, which the lake must never see.
  mkdirSync(join(imports, "work"), { recursive: true });
  await $`cp -R ${fixturesDir}/. ${join(imports, "work", "projects")}`.quiet();
  await Bun.write(
    join(imports, "work", "manifest.json"),
    JSON.stringify({ host: "work", source: "test", imported_at: "2026-10-21", policy: {} }),
  );
  options = {
    url: join(dir, "lake"),
    hosts: ["local"],
    index: sessionDbPath(dir),
    stateDir: dir,
    importsDir: imports,
  };
  await refresh();
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("publish", () => {
  test("a first publish matches the local index for the published hosts", async () => {
    const db = await getDb(dir);
    const hosts = await db
      .query("SELECT DISTINCT host FROM raw ORDER BY 1", z.object({ host: z.string() }))
      .finally(() => {
        db.close();
      });
    expect(hosts.map((h) => h.host)).toEqual(["local", "work"]);

    const result = await publish(options);
    expect(result.files).toBeGreaterThan(0);
    const ts = await tables();
    expect(await drift(ts)).toEqual(clean(ts));
  }, 120_000);

  test("an unchanged index publishes nothing", async () => {
    expect(await publish(options)).toEqual({ files: 0, sessions: 0 });
  }, 60_000);

  test("a changed and a removed file republish only their sessions", async () => {
    const tools = join(projects, "-Users-test-project", "tools.jsonl");
    const text = await Bun.file(tools).text();
    await Bun.write(tools, `${text}${text.trim().split("\n").at(-1) ?? ""}\n`);
    await Bun.file(join(projects, "-Users-test-project", "replay.jsonl")).delete();
    await refresh();

    const result = await publish(options);
    expect(result.files).toBe(2);
    const ts = await tables();
    expect(await drift(ts)).toEqual(clean(ts));
  }, 120_000);

  test("refuses a host imported without --egress", async () => {
    const manifest = join(imports, "work", "manifest.json");
    const original = await Bun.file(manifest).text();
    await Bun.write(
      manifest,
      JSON.stringify({ ...JSON.parse(original), policy: { block_egress: true } }),
    );
    try {
      const refused = await publish({ ...options, hosts: ["local", "work"] }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(Error);
      expect(String(refused)).toContain("work");
    } finally {
      await Bun.write(manifest, original);
    }
  });
});
