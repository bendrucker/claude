#!/usr/bin/env bun
import { join, relative } from "node:path";
import { loadQueryHeaders, type QueryHeader } from "./query-header";

const REFERENCES_DIR = join(import.meta.dirname, "..", "references");
export const CATALOG_PATH = join(REFERENCES_DIR, "catalog.md");
export const DISCOVERY_PATH = join(REFERENCES_DIR, "discovery.md");
export const SKILL_PATH = join(import.meta.dirname, "..", "SKILL.md");

// Survey surfaces are per-dimension starting points, so the dimension registry lives here
// and each query declares its membership in its own header.
export const DIMENSIONS = [
  { slug: "hook-latency", label: "Hook latency", surfaces: ["hooks"] },
  { slug: "hook-blocks", label: "Hook blocks", surfaces: ["hook-blocks", "hooks"] },
  { slug: "hook-coverage", label: "Hook coverage", surfaces: ["hooks"] },
  {
    slug: "permissions-sandbox",
    label: "Permissions and sandbox",
    surfaces: ["permissions", "sandbox_bypasses"],
  },
  { slug: "tool-failures", label: "Tool failures", surfaces: ["tool-failure-rates"] },
  {
    slug: "context-tax",
    label: "Context tax",
    surfaces: ["activity", "hooks (additionalContext)"],
  },
  { slug: "tokens", label: "Tokens", surfaces: ["stats", "model-summary", "skill-activity"] },
  {
    slug: "turns-compaction",
    label: "Turns and compaction",
    surfaces: ["activity (compactions, API errors)"],
  },
  { slug: "skill-economy", label: "Skill economy", surfaces: ["skill_calls", "skill-activity"] },
  { slug: "planning", label: "Planning", surfaces: ["plan_sessions", "plan_calls"] },
  { slug: "outcomes", label: "Outcomes", surfaces: ["pr_links", "plan_calls", "file_operations"] },
] as const;

// A surface is a query or view name, optionally followed by a parenthetical narrowing it.
export const SURFACE_NAME = /^[a-z_-]+/;

function renderSurface(surface: string): string {
  return surface.replace(SURFACE_NAME, (name) => `\`${name}\``);
}

// scoped_sessions() reads these on a query's behalf, and every query takes them, so the index
// leaves them out.
export const SCOPE_PARAMS = ["after_date", "before_date", "project", "host"];

function renderEntry(header: QueryHeader): string {
  const params = header.params
    .filter((param) => !SCOPE_PARAMS.includes(param.name))
    .map((param) => `\`${param.name}\`${param.required === true ? " (required)" : ""}`);
  const extensions = header.extensions.map((name) => `\`${name}\` extension`);
  const notes = [...params, ...extensions];
  const tail = notes.length === 0 ? "" : ` [${notes.join(", ")}]`;
  return `- \`${header.name}\`${tail}: ${header.summary}`;
}

function replaceRegion(text: string, id: string, body: string): string {
  const open = `<!-- generated:${id} -->`;
  const close = `<!-- /generated:${id} -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1 || end < start) throw new Error(`no generated:${id} region`);
  return `${text.slice(0, start)}${open}\n${body}\n${text.slice(end)}`;
}

export function renderCatalog(headers: QueryHeader[], current: string): string {
  const indexed = headers.filter((header) => header.reads === "index");
  const onDisk = headers.filter((header) => header.reads === "disk");
  if (onDisk.length === 0) throw new Error("no on-disk queries; the section would render empty");

  return replaceRegion(
    replaceRegion(current, "queries", indexed.map(renderEntry).join("\n")),
    "on-disk-queries",
    onDisk.map(renderEntry).join("\n"),
  );
}

function renderDimensionTable(headers: QueryHeader[]): string {
  const known = new Set<string>(DIMENSIONS.map((dimension) => dimension.slug));
  for (const header of headers) {
    const unknown = header.dimensions.filter((slug) => !known.has(slug));
    if (unknown.length > 0) throw new Error(`${header.name}: unknown dimension ${unknown[0]}`);
  }

  const rows = DIMENSIONS.map((dimension) => {
    const queries = headers
      .filter((header) => header.dimensions.some((slug) => slug === dimension.slug))
      .map((header) => `\`${header.name}\``);
    if (queries.length === 0) throw new Error(`no query claims dimension ${dimension.slug}`);
    const surfaces = dimension.surfaces.map(renderSurface);
    return `| ${dimension.label} | ${queries.join(", ")} | ${surfaces.join(", ")} |`;
  });

  return [
    "| Dimension | Named queries | Survey surfaces |",
    "|-----------|---------------|-----------------|",
    ...rows,
  ].join("\n");
}

export function renderDiscovery(headers: QueryHeader[], current: string): string {
  return replaceRegion(current, "dimensions", renderDimensionTable(headers));
}

// SKILL.md names its most-used queries by hand, above the region, and the region names the rest.
const CURATED = /^- `([a-z-]+)`:/gm;

export function renderSkill(headers: QueryHeader[], current: string): string {
  const section = current.slice(current.indexOf("\n## Named Queries"));
  const curated = new Set(
    [...section.slice(0, section.indexOf("<!-- generated:")).matchAll(CURATED)].map((m) => m[1]),
  );
  const rest = headers.filter((header) => !curated.has(header.name));
  return replaceRegion(current, "queries", rest.map((header) => `\`${header.name}\``).join(", "));
}

if (import.meta.main) {
  const headers = await loadQueryHeaders();
  const targets = [
    [CATALOG_PATH, renderCatalog],
    [DISCOVERY_PATH, renderDiscovery],
    [SKILL_PATH, renderSkill],
  ] as const;
  await Promise.all(
    targets.map(async ([file, render]) => {
      await Bun.write(file, render(headers, await Bun.file(file).text()));
      console.log(relative(process.cwd(), file));
    }),
  );
}
