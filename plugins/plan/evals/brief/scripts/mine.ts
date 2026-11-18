#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { getDataDir, sessionDbPath } from "../../../../observability/skills/session/scripts/db";
import { cliAdapter, runQuery } from "../../../../observability/skills/session/scripts/query";
import type { CaseRecord } from "./case-record";
import { feedbackFrom, isExcluded, tagRedirect } from "./redirect";
import { renderPrefix, type TranscriptItem } from "./transcript";

// Sessions whose first plan the user redirected, replayed up to the plan write. The
// output holds session text from every host, so it stays in the gitignored data/.

const DEFAULT_SINCE = "2026-10-01";

const RedirectRow = z.object({
  host: z.string(),
  session_id: z.string(),
  project_path: z.string().nullable(),
  plan: z.string().nullable(),
  result: z.string().nullable(),
  next_prompt: z.string().nullable(),
  cutoff: z.string(),
});
export type RedirectRow = z.infer<typeof RedirectRow>;

const ItemRow = z.object({
  host: z.string(),
  session_id: z.string(),
  kind: z.enum(["prompt", "text", "tool_use", "tool_result"]),
  name: z.string().nullable(),
  text: z.string().nullable(),
});

function checkDate(since: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`--since must be a YYYY-MM-DD date, got ${JSON.stringify(since)}`);
  }
}

const FIRST_PLAN = `
WITH plans AS (
  SELECT pc.host, pc.session_id, pc.project_path, pc.tool_use_id, pc.plan_file, pc.timestamp, pc.outcome,
    json_extract_string(ci.data, '$.input.plan') AS plan,
    r.content AS result,
    ROW_NUMBER() OVER (PARTITION BY pc.host, pc.session_id ORDER BY pc.timestamp) AS seq
  FROM plan_calls pc
  JOIN content_items ci ON ci.host = pc.host AND ci.id = pc.tool_use_id AND ci.type = 'tool_use'
  LEFT JOIN content_items r ON r.host = pc.host AND r.tool_use_id = pc.tool_use_id AND r.type = 'tool_result'
  WHERE ci.source_file NOT LIKE '%/subagents/%'
)`;

export function redirectsSql(since: string): string {
  checkDate(since);
  return `${FIRST_PLAN}
SELECT p.host, p.session_id, p.project_path, p.plan, p.result,
  (SELECT substr(m.content_text, 1, 4000) FROM messages m
     WHERE m.host = p.host AND m.session_id = p.session_id AND m.type = 'user'
       AND m.prompt_source IN ('typed', 'queued') AND m.timestamp > p.timestamp
     ORDER BY m.timestamp LIMIT 1) AS next_prompt,
  CAST(COALESCE((SELECT MIN(w.timestamp) FROM content_items w
     WHERE w.host = p.host AND w.session_id = p.session_id AND w.type = 'tool_use' AND w.name = 'Write'
       AND w.source_file NOT LIKE '%/subagents/%'
       AND (w.data->>'$.input.file_path') = p.plan_file), p.timestamp) AS VARCHAR) AS cutoff
FROM plans p
WHERE p.seq = 1 AND p.outcome = 'redirected' AND p.timestamp >= TIMESTAMP '${since}'
ORDER BY p.host, p.session_id
`;
}

export function itemsSql(rows: readonly RedirectRow[]): string {
  const cutoffs = rows
    .map(
      (r) =>
        `('${r.host.replaceAll("'", "''")}', '${r.session_id.replaceAll("'", "''")}', TIMESTAMP '${r.cutoff}')`,
    )
    .join(", ");
  return `
WITH cut(host, session_id, cutoff) AS (VALUES ${cutoffs})
SELECT ci.host, ci.session_id,
  ci.type AS kind,
  ci.name,
  CASE ci.type
    WHEN 'tool_use' THEN substr(coalesce(ci.data->>'$.input.command', ci.data->>'$.input.file_path',
      ci.data->>'$.input.pattern', ci.data->>'$.input.path', ci.data->>'$.input.url',
      ci.data->>'$.input.description', ci.data->>'$.input.query', ci.data->>'$.input.prompt',
      ci.data->>'$.input.skill', substr(CAST(ci.data->'$.input' AS VARCHAR), 1, 200)), 1, 200)
    WHEN 'tool_result' THEN substr(ci.content, 1, 1600)
    ELSE substr(ci.text, 1, 8000)
  END AS text
FROM content_items ci
JOIN cut ON cut.host = ci.host AND cut.session_id = ci.session_id
WHERE ci.timestamp < cut.cutoff
  AND ci.source_file NOT LIKE '%/subagents/%'
  AND NOT ci.is_meta
  AND ((ci.type = 'prompt' AND ci.role = 'user')
    OR (ci.type = 'text' AND ci.role = 'assistant')
    OR ci.type IN ('tool_use', 'tool_result'))
ORDER BY ci.host, ci.session_id, ci.timestamp, ci.source_line
`;
}

export interface Mined {
  cases: CaseRecord[];
  excluded: number;
}

export function buildCases(
  rows: readonly RedirectRow[],
  itemsBySession: ReadonlyMap<string, TranscriptItem[]>,
): Mined {
  const cases: CaseRecord[] = [];
  let excluded = 0;
  for (const row of rows) {
    const redirect = feedbackFrom(row.result) ?? row.next_prompt?.trim() ?? "";
    if (redirect === "" || row.plan === null || row.plan.trim() === "") continue;
    if (isExcluded(redirect)) {
      excluded += 1;
      continue;
    }
    cases.push({
      id: `${row.host.slice(0, 1)}-${row.session_id.slice(0, 8)}`,
      host: row.host,
      session_id: row.session_id,
      project: row.project_path === null ? "" : basename(row.project_path),
      tags: [tagRedirect(redirect)],
      prefix: renderPrefix(itemsBySession.get(sessionKey(row)) ?? []),
      redirect,
      original_plan: row.plan,
    });
  }
  return { cases, excluded };
}

export function sessionKey(row: { host: string; session_id: string }): string {
  return `${row.host}/${row.session_id}`;
}

function groupItems(rows: z.infer<typeof ItemRow>[]): Map<string, TranscriptItem[]> {
  const grouped = new Map<string, TranscriptItem[]>();
  for (const row of rows) {
    const key = sessionKey(row);
    const items = grouped.get(key) ?? [];
    items.push({ kind: row.kind, name: row.name, text: row.text ?? "" });
    grouped.set(key, items);
  }
  return grouped;
}

function count(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k}=${n}`).join(", ");
}

export const program = new Command("mine")
  .description("Mine first-plan redirects from the session index into data/cases.json.")
  .option("--db <path>", "session.duckdb path (defaults to the session skill's data dir)")
  .option("--since <date>", "Earliest plan date", DEFAULT_SINCE)
  .option("--out <path>", "Output path", join(import.meta.dirname, "..", "data", "cases.json"))
  .action(async (options) => {
    const dbPath = options.db ?? sessionDbPath(getDataDir());
    if (!(await Bun.file(dbPath).exists())) {
      console.error(`No session index at ${dbPath}. Run the observability:session refresh first.`);
      process.exit(1);
    }
    const adapter = cliAdapter(dbPath);
    const rows = await runQuery(adapter, { sql: redirectsSql(options.since) }, RedirectRow);
    const itemRows =
      rows.length === 0 ? [] : await runQuery(adapter, { sql: itemsSql(rows) }, ItemRow);
    const { cases, excluded } = buildCases(rows, groupItems(itemRows));

    await mkdir(dirname(options.out), { recursive: true });
    await Bun.write(options.out, `${JSON.stringify(cases, null, 2)}\n`);

    const sizes = cases.map((c) => c.prefix.length).toSorted((a, b) => a - b);
    console.log(
      `${rows.length} first-plan redirects, ${excluded} excluded, ${cases.length} cases -> ${options.out}`,
    );
    console.log(`hosts: ${count(cases.map((c) => c.host))}`);
    console.log(`tags: ${count(cases.flatMap((c) => c.tags))}`);
    if (sizes.length > 0) {
      console.log(
        `prefix chars: min=${sizes[0]}, median=${sizes[Math.floor(sizes.length / 2)]}, max=${sizes.at(-1)}`,
      );
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
