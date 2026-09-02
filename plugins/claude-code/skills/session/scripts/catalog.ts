#!/usr/bin/env bun
import * as path from "node:path";
import { loadQueryHeaders, type QueryHeader } from "./query-header";

const REFERENCES_DIR = path.join(import.meta.dirname, "..", "references");
export const CATALOG_PATH = path.join(REFERENCES_DIR, "catalog.md");
export const DISCOVERY_PATH = path.join(REFERENCES_DIR, "discovery.md");
export const SKILL_PATH = path.join(import.meta.dirname, "..", "SKILL.md");

// Survey surfaces are per-dimension starting points rather than per-query metadata, so the
// dimension registry lives here and each query declares its membership in its own header.
export const DIMENSIONS = [
  { slug: "hook-latency", label: "Hook latency", surfaces: ["`hooks`"] },
  { slug: "hook-blocks", label: "Hook blocks", surfaces: ["`hook-blocks`", "`hooks`"] },
  { slug: "hook-coverage", label: "Hook coverage", surfaces: ["`hooks`"] },
  {
    slug: "permissions-sandbox",
    label: "Permissions and sandbox",
    surfaces: ["`permissions`", "`sandbox`"],
  },
  {
    slug: "context-tax",
    label: "Context tax",
    surfaces: ["`activity`", "`hooks` (additionalContext)"],
  },
  {
    slug: "tokens",
    label: "Tokens",
    surfaces: ["`stats`", "`model-summary`", "`skill-activity`"],
  },
  {
    slug: "turns-compaction",
    label: "Turns and compaction",
    surfaces: ["`activity` (compactions, API errors)"],
  },
  { slug: "skill-economy", label: "Skill economy", surfaces: ["`skills`", "`skill-activity`"] },
  { slug: "planning", label: "Planning", surfaces: ["`plan_sessions`", "`plan_calls`"] },
  {
    slug: "outcomes",
    label: "Outcomes",
    surfaces: ["`pr_links`", "`plan_calls`", "`file_operations`"],
  },
] as const;

function renderExtensions(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.map((name) => `\`${name}\``).join(" and ");
  const noun = names.length === 1 ? "extension" : "extensions";
  return `Needs the ${list} community ${noun} (\`-init resources/extensions.sql\`).`;
}

function renderParam(param: QueryHeader["params"][number]): string {
  const notes = [
    param.required === true ? "required" : null,
    param.default === undefined ? null : `default \`${param.default}\``,
    param.meaning ?? null,
  ].filter((note) => note !== null);
  return notes.length === 0 ? `\`${param.name}\`` : `\`${param.name}\` (${notes.join(", ")})`;
}

function renderEntry(header: QueryHeader): string {
  const tail = [
    renderExtensions(header.extensions),
    header.params.length === 0 ? null : `Params: ${header.params.map(renderParam).join(", ")}.`,
  ]
    .filter((part) => part !== null)
    .join(" ");

  // Descriptions are folded YAML scalars, so a blank line in the header arrives as a single
  // newline and marks a paragraph break.
  const paragraphs = (header.description ?? "")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const blocks = [
    [header.summary, paragraphs[0]].filter((part) => part !== undefined).join(" "),
  ].concat(paragraphs.slice(1));
  if (tail !== "") {
    if (blocks.length > 1) blocks.push(tail);
    else blocks[0] = `${blocks[0]} ${tail}`;
  }

  const [lead, ...rest] = blocks;
  return `- \`${header.name}\`: ${lead}${rest.map((block) => `\n\n  ${block}`).join("")}`;
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
  const known = new Set(DIMENSIONS.map((dimension) => dimension.slug));
  for (const header of headers) {
    const unknown = header.dimensions.filter((slug) => !known.has(slug));
    if (unknown.length > 0) throw new Error(`${header.name}: unknown dimension ${unknown[0]}`);
  }

  const rows = DIMENSIONS.map((dimension) => {
    const queries = headers
      .filter((header) => header.dimensions.some((slug) => slug === dimension.slug))
      .map((header) => `\`${header.name}\``);
    if (queries.length === 0) throw new Error(`no query claims dimension ${dimension.slug}`);
    return `| ${dimension.label} | ${queries.join(", ")} | ${dimension.surfaces.join(", ")} |`;
  });

  return [
    "| Dimension | Named queries | Survey surfaces |",
    "|-----------|---------------|-----------------|",
    ...rows,
  ].join("\n");
}

export function renderDiscovery(headers: QueryHeader[], current: string): string {
  const tier2 = headers.filter((header) => header.tier === 2);
  if (tier2.length === 0) throw new Error("no tier-2 queries; the section would render empty");

  return replaceRegion(
    replaceRegion(current, "dimensions", renderDimensionTable(headers)),
    "tier-2",
    tier2.map((header) => `- \`${header.name}\`: ${header.summary}`).join("\n"),
  );
}

if (import.meta.main) {
  const headers = await loadQueryHeaders();
  const targets = [
    [CATALOG_PATH, renderCatalog],
    [DISCOVERY_PATH, renderDiscovery],
  ] as const;
  await Promise.all(
    targets.map(async ([file, render]) => {
      await Bun.write(file, render(headers, await Bun.file(file).text()));
      console.log(path.relative(process.cwd(), file));
    }),
  );
}
