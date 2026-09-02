import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { z } from "zod";
import {
  CATALOG_PATH,
  DISCOVERY_PATH,
  renderCatalog,
  renderDiscovery,
  SKILL_PATH,
} from "./catalog";
import { type Database, ensureIndex, getDb, runQuery } from "./db";
import { loadQueryHeaders, parseQueryHeader, QUERIES_DIR } from "./query-header";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");

const VALID = `-- ---
-- name: demo
-- tier: 2
-- dimensions: [tokens]
-- reads: disk
-- extensions: [yaml]
-- summary: >-
--   A one-line purpose that
--   wraps.
-- description: >-
--   First paragraph.
--
--   Second paragraph.
-- params:
--   - after_date
--   - name: limit
--     default: 15
--     meaning: reserved word
--   - name: session
--     required: true
-- ---
-- Free prose the parser ignores.
SELECT 1;
`;

const MALFORMED: [string, string][] = [
  ["no fence on line 1", "SELECT 1;\n"],
  ["unterminated fence", "-- ---\n-- name: demo\nSELECT 1;\n"],
  [
    "a key outside the schema",
    "-- ---\n-- name: demo\n-- tier: 1\n-- summary: s\n-- oops: x\n-- ---\n",
  ],
  ["no summary", "-- ---\n-- name: demo\n-- tier: 1\n-- ---\n"],
  ["a tier that is not 1 or 2", "-- ---\n-- name: demo\n-- tier: 3\n-- summary: s\n-- ---\n"],
  ["unparseable YAML", "-- ---\n-- name: [demo\n-- ---\n"],
  ["a non-comment line inside the fence", "-- ---\nname: demo\n-- ---\n"],
];

describe("query header", () => {
  it("parses the fenced YAML and leaves the free prose alone", () => {
    expect(parseQueryHeader(VALID)).toEqual({
      name: "demo",
      tier: 2,
      dimensions: ["tokens"],
      reads: "disk",
      extensions: ["yaml"],
      summary: "A one-line purpose that wraps.",
      description: "First paragraph.\nSecond paragraph.",
      params: [
        { name: "after_date" },
        { name: "limit", default: 15, meaning: "reserved word" },
        { name: "session", required: true },
      ],
    });
  });

  it.each(MALFORMED)("rejects %s", (_label, sql) => {
    expect(() => parseQueryHeader(sql)).toThrow();
  });

  it("declares exactly the params its SQL reads", async () => {
    const headers = await loadQueryHeaders();
    const alphabetical = (names: (string | undefined)[]) =>
      names.toSorted((a, b) => (a ?? "").localeCompare(b ?? ""));

    const used = await Promise.all(
      headers.map(async (header) => {
        const sql = await Bun.file(path.join(QUERIES_DIR, `${header.name}.sql`)).text();
        const names = [...sql.matchAll(/getvariable\('([a-z_]+)'\)/g)].map((match) => match[1]);
        return [header.name, alphabetical([...new Set(names)])] as const;
      }),
    );
    const declared = headers.map(
      (header) => [header.name, alphabetical(header.params.map((param) => param.name))] as const,
    );
    expect(declared).toEqual(used);
  });
});

describe("generated reference docs", () => {
  // Regenerate with UPDATE_QUERY_CATALOG=1 after editing a query header.
  it.each([
    ["catalog.md", CATALOG_PATH, renderCatalog],
    ["discovery.md", DISCOVERY_PATH, renderDiscovery],
  ] as const)("keeps %s in step with the query headers", async (_label, file, render) => {
    const committed = await Bun.file(file).text();
    const rendered = render(await loadQueryHeaders(), committed);

    if (process.env.UPDATE_QUERY_CATALOG !== undefined) await Bun.write(file, rendered);

    expect(rendered).toBe(await Bun.file(file).text());
  });

  it("refuses to render a dimension no query claims", async () => {
    const headers = await loadQueryHeaders();
    for (const header of headers) header.dimensions = [];
    expect(() => renderDiscovery(headers, "")).toThrow(/dimension/);
  });

  it("refuses a header naming a dimension the registry does not define", async () => {
    const headers = await loadQueryHeaders();
    const first = headers[0];
    if (first === undefined) throw new Error("no query headers");
    expect(() => renderDiscovery([{ ...first, dimensions: ["invented"] }, ...headers], "")).toThrow(
      /invented/,
    );
  });
});

describe("SKILL.md name index", () => {
  it("lists every tier-1 query and no tier-2 one", async () => {
    const skill = await Bun.file(SKILL_PATH).text();
    const section = skill.slice(skill.indexOf("\n## Named Queries")).split("\n## ")[1] ?? "";
    // Two bullet shapes carry names: "- `name`: prose", where only the leading token is a
    // query, and "- Category: `a`, `b`", where every token is.
    const listed = new Set(
      section.split("\n").flatMap((line) => {
        const named = /^- `([a-z-]+)`:/.exec(line);
        if (named?.[1] !== undefined) return [named[1]];
        const grouped = /^- [^`]+: (.+)$/.exec(line);
        return [...(grouped?.[1] ?? "").matchAll(/`([a-z-]+)`/g)].map((match) => match[1]);
      }),
    );

    const headers = await loadQueryHeaders();
    const names = new Set(headers.map((header) => header.name));
    const byTier = (tier: 1 | 2) =>
      headers.filter((header) => header.tier === tier).map((header) => header.name);

    expect(byTier(1).filter((name) => !listed.has(name))).toEqual([]);
    expect(byTier(2).filter((name) => listed.has(name))).toEqual([]);
    expect([...listed].filter((name) => !names.has(name))).toEqual([]);
  });
});

describe("a header-bearing query", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "session-catalog-"));
    db = await getDb(tmpDir);
    await ensureIndex(db, { projectsDir: fixturesDir, importsDir: path.join(tmpDir, "imports") });
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("still runs, because DuckDB reads the fence as comments", async () => {
    expect(parseQueryHeader(await Bun.file(path.join(QUERIES_DIR, "stats.sql")).text()).name).toBe(
      "stats",
    );

    const rows = await runQuery(db, "stats", z.object({ tool_name: z.string() }), {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});
