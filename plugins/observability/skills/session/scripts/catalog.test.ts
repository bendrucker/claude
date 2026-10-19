import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  CATALOG_PATH,
  DIMENSIONS,
  DISCOVERY_PATH,
  renderCatalog,
  renderDiscovery,
  renderSkill,
  SCOPE_PARAMS,
  SKILL_PATH,
  SURFACE_NAME,
} from "./catalog";
import { loadQueryHeaders, parseQueryHeader, QUERIES_DIR, type QueryHeader } from "./query-header";

const VALID = `-- ---
-- name: demo
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
-- example: |-
--   SELECT 1
--     FROM t;
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
  ["a key outside the schema", "-- ---\n-- name: demo\n-- summary: s\n-- oops: x\n-- ---\n"],
  ["no summary", "-- ---\n-- name: demo\n-- ---\n"],
  ["unparseable YAML", "-- ---\n-- name: [demo\n-- ---\n"],
  ["a non-comment line inside the fence", "-- ---\nname: demo\n-- ---\n"],
];

// A default the query applies itself, in either shape its SQL uses:
// `COALESCE(getvariable('x'), 15)` and `COALESCE(TRY_CAST(getvariable('x') AS INTEGER), 15)`.
const DEFAULT_FALLBACK =
  /COALESCE\( ?(?:TRY_CAST\( ?)?getvariable\('(\w+)'\)(?: AS \w+ ?\))? ?, ?('[^']*'|-?\d+) ?\)/g;

const EXTENSION_FUNCTIONS = {
  markdown: ["read_markdown_sections", "md_to_text"],
  yaml: ["read_yaml_frontmatter"],
} as const;

const alphabetical = (values: (string | undefined)[]) =>
  values.toSorted((a, b) => (a ?? "").localeCompare(b ?? ""));

async function loadQueries(): Promise<[QueryHeader, string][]> {
  const headers = await loadQueryHeaders();
  return Promise.all(
    headers.map(
      async (header) =>
        [header, await Bun.file(join(QUERIES_DIR, `${header.name}.sql`)).text()] as [
          QueryHeader,
          string,
        ],
    ),
  );
}

describe("query header", () => {
  it("parses the fenced YAML and leaves the free prose alone", () => {
    expect(parseQueryHeader(VALID)).toEqual({
      name: "demo",
      dimensions: ["tokens"],
      reads: "disk",
      extensions: ["yaml"],
      summary: "A one-line purpose that wraps.",
      description: "First paragraph.\nSecond paragraph.",
      example: "SELECT 1\n  FROM t;",
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
    const queries = await loadQueries();
    const used = queries.map(([header, sql]) => {
      const names = [...sql.matchAll(/getvariable\('([a-z_]+)'\)/g)].map((match) => match[1]);
      if (sql.includes("scoped_sessions()")) names.push(...SCOPE_PARAMS);
      return [header.name, alphabetical([...new Set(names)])] as const;
    });
    const declared = queries.map(
      ([header]) => [header.name, alphabetical(header.params.map((param) => param.name))] as const,
    );
    expect(declared).toEqual(used);
  });

  it("declares the community extensions its SQL calls into", async () => {
    const queries = await loadQueries();
    const used = queries.map(([header, sql]) => {
      const names = Object.entries(EXTENSION_FUNCTIONS)
        .filter(([, functions]) => functions.some((fn) => sql.includes(`${fn}(`)))
        .map(([extension]) => extension);
      return [header.name, names] as const;
    });
    const declared = queries.map(([header]) => {
      const names: string[] = [...header.extensions];
      return [header.name, names] as const;
    });
    expect(declared).toEqual(used);
  });

  it("documents every default its SQL falls back to", async () => {
    const queries = await loadQueries();
    const used = queries.map(([header, sql]) => {
      const pairs = [...sql.replaceAll(/\s+/g, " ").matchAll(DEFAULT_FALLBACK)].map(
        ([, name, value]) => `${name}=${(value ?? "").replaceAll(/^'|'$/g, "")}`,
      );
      return [header.name, alphabetical([...new Set(pairs)])] as const;
    });
    const declared = queries.map(([header]) => {
      const pairs = header.params
        .filter((param) => param.default !== undefined)
        .map((param) => `${param.name}=${param.default}`);
      return [header.name, alphabetical(pairs)] as const;
    });
    expect(declared).toEqual(used);
  });
});

describe("generated reference docs", () => {
  // Regenerate with UPDATE_QUERY_CATALOG=1 after editing a query header.
  it.each([
    ["catalog.md", CATALOG_PATH, renderCatalog],
    ["discovery.md", DISCOVERY_PATH, renderDiscovery],
    ["SKILL.md", SKILL_PATH, renderSkill],
  ] as const)("keeps %s in step with the query headers", async (_label, file, render) => {
    const committed = await Bun.file(file).text();
    const rendered = render(await loadQueryHeaders(), committed);

    if (process.env.UPDATE_QUERY_CATALOG !== undefined) await Bun.write(file, rendered);

    expect(rendered).toBe(await Bun.file(file).text());
  });

  it("cites survey surfaces that exist as a query or a view", async () => {
    const views = await Bun.file(join(import.meta.dirname, "..", "resources", "views.sql")).text();
    const known = new Set([
      ...(await loadQueryHeaders()).map((header) => header.name),
      ...[...views.matchAll(/CREATE OR REPLACE (?:VIEW|TABLE) ([a-z_]+)/g)].map(
        (match) => match[1],
      ),
    ]);

    const cited = DIMENSIONS.flatMap((dimension) =>
      dimension.surfaces.map((surface) => SURFACE_NAME.exec(surface)?.[0]),
    );
    expect(cited.filter((name) => name === undefined || !known.has(name))).toEqual([]);
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
  it("curates only queries that exist", async () => {
    const skill = await Bun.file(SKILL_PATH).text();
    const curated = [...skill.matchAll(/^- `([a-z][a-z-]*)`:/gm)].map((match) => match[1] ?? "");
    const names = new Set((await loadQueryHeaders()).map((header) => header.name));
    expect(curated.filter((name) => !names.has(name))).toEqual([]);
  });
});
