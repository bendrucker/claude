// Which of views.sql's statements a publish materializes and which a reader defines.
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogUrl, isRemote, quote, s3Setup } from "./store";

const RESOURCES_DIR = join(import.meta.dirname, "..", "..", "resources");

// Views over file_fields stay views: the registry is small and not session-scoped.
// classifier_verdicts reads mod_events, which is local telemetry and never published.
const KEPT_VIEWS = new Set(["fields", "field_triage", "view_paths"]);
const LOCAL_ONLY = new Set(["classifier_verdicts"]);
// Table macros that read the refresh's scope tables bind them when created, so a
// reader cannot define them.
const WRITER_MACROS = new Set(["content_item_rows", "search_item_rows", "field_rows"]);

interface Statement {
  kind: string;
  name: string;
  sql: string;
}

/** views.sql cut at each top-level CREATE. Comments above one stay with the one before. */
export function viewStatements(sql: string): Statement[] {
  const starts = [...sql.matchAll(/^CREATE OR REPLACE (VIEW|MACRO|TABLE) (\w+)/gm)];
  return starts.map((m, i) => ({
    kind: m[1] ?? "",
    name: m[2] ?? "",
    sql: sql.slice(m.index, starts[i + 1]?.index ?? sql.length).trim(),
  }));
}

const read = (name: string) => Bun.file(join(RESOURCES_DIR, name)).text();

export const loadViews = async (): Promise<Statement[]> => viewStatements(await read("views.sql"));

/** The views a publish writes as tables, so a reader's projection skips the JSON they parse. */
export function materializedViews(statements: Statement[]): string[] {
  return statements
    .filter((s) => s.kind === "VIEW" && !KEPT_VIEWS.has(s.name) && !LOCAL_ONLY.has(s.name))
    .map((s) => s.name);
}

/**
 * The SQL a reader runs before its query. Unqualified names resolve to the lake's
 * tables.
 */
export async function readerInit(url: string): Promise<string> {
  const kept = (await loadViews()).filter((s) =>
    s.kind === "MACRO" ? !WRITER_MACROS.has(s.name) : KEPT_VIEWS.has(s.name),
  );
  // extensions.sql's split reads the proxy when the reader starts, so no credential lands in
  // the init file.
  const proxy = (await read("extensions.sql"))
    .split("\n")
    .filter((l) => /^SET (VARIABLE proxy_url|http_proxy)/.test(l));
  return [
    await read("limits.sql"),
    isRemote(url) ? s3Setup(proxy) : "",
    "LOAD ducklake;",
    `ATTACH ${quote(`ducklake:${catalogUrl(url)}`)} AS lake (READ_ONLY);`,
    "SET search_path = 'memory.main,lake.main';",
    await read("schema/00_pinned.sql"),
    await read("schema/03_macros.sql"),
    ...kept.map((s) => s.sql),
  ].join("\n");
}

/** Writes the reader init for `url` under $TMPDIR, keyed by its content, and returns the path. */
export async function writeReaderInit(url: string): Promise<string> {
  const sql = await readerInit(url);
  const hash = createHash("sha256").update(sql).digest("hex").slice(0, 12);
  const path = join(tmpdir(), "claude-session-lake", `${hash}.sql`);
  if (!(await Bun.file(path).exists())) await Bun.write(path, sql);
  return path;
}
