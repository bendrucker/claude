#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { getDataDir, sessionDbPath } from "../../../../observability/skills/session/scripts/db";
import { cliAdapter, runQuery } from "../../../../observability/skills/session/scripts/query";
import { classifyResponse, type Present } from "../../../hooks/decisions";

// Mine every ExitPlanMode presentation since the gate switched to deny (#1216,
// 2026-08-15): the plan text, the response the call received, and the model that
// wrote it. Both hosts land in data/, which is gitignored: the replay needs the
// full history for fidelity.

const DEFAULT_SINCE = "2026-08-15";

const MinedRow = z.object({
  host: z.string(),
  session_id: z.string(),
  project_path: z.string().nullable(),
  timestamp: z.string(),
  seq: z.number(),
  plan: z.string().nullable(),
  plan_file: z.string().nullable(),
  model: z.string().nullable(),
  response: z.string().nullable(),
});

export function sql(since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`--since must be a YYYY-MM-DD date, got ${JSON.stringify(since)}`);
  }
  return `
WITH presents AS (
  SELECT ci.host,
    ci.session_id,
    ci.project_path,
    ci.timestamp,
    json_extract_string(ci.data, '$.input.plan') AS plan,
    (ci.data->>'$.input.planFilePath') AS plan_file,
    r.content AS response
  FROM content_items ci
  LEFT JOIN content_items r
    ON r.tool_use_id = ci.id
   AND r.host = ci.host
   AND r.type = 'tool_result'
  WHERE ci.type = 'tool_use'
    AND ci.name = 'ExitPlanMode'
    AND subagent_id(ci.source_file) IS NULL
    AND ci.timestamp >= TIMESTAMP '${since}'
)
SELECT p.host,
  p.session_id,
  p.project_path,
  CAST(p.timestamp AS VARCHAR) AS timestamp,
  CAST(ROW_NUMBER() OVER (PARTITION BY p.host, p.session_id ORDER BY p.timestamp) AS INTEGER) AS seq,
  p.plan,
  p.plan_file,
  (SELECT mu.model
     FROM message_usage mu
    WHERE mu.host = p.host
      AND mu.session_id = p.session_id
      AND NOT mu.is_sidechain
      AND mu.timestamp <= p.timestamp
    ORDER BY mu.timestamp DESC
    LIMIT 1) AS model,
  p.response
FROM presents p
ORDER BY p.host, p.session_id, p.timestamp
`;
}

export function toPresent(row: z.infer<typeof MinedRow>): Present {
  const plan = row.plan ?? "";
  return {
    host: row.host,
    session_id: row.session_id,
    session: row.session_id.slice(0, 8),
    project_path: row.project_path,
    timestamp: row.timestamp,
    seq: row.seq,
    chars: plan.length,
    plan,
    plan_file: row.plan_file,
    model: row.model,
    response: row.response,
    actual: classifyResponse(row.response),
  };
}

function resolveDbPath(db: string | undefined): string {
  return db != null && db !== "" ? db : sessionDbPath(getDataDir());
}

async function queryPresents(dbPath: string, since: string): Promise<Present[]> {
  const rows = await runQuery(cliAdapter(dbPath), { sql: sql(since) }, MinedRow);
  return rows.map(toPresent);
}

export const program = new Command("mine")
  .description("Mine ExitPlanMode presentations from the session index.")
  .option("--db <path>", "session.duckdb path (defaults to the session skill's data dir)")
  .option("--since <date>", "Earliest presentation date", DEFAULT_SINCE)
  .option("--out <path>", "Output path", join(import.meta.dirname, "..", "data", "presents.json"))
  .action(async (options) => {
    const dbPath = resolveDbPath(options.db);
    if (!(await Bun.file(dbPath).exists())) {
      console.error(`No session index at ${dbPath}. Run the observability:session refresh first.`);
      process.exit(1);
    }
    const presents = await queryPresents(dbPath, options.since);
    await mkdir(dirname(options.out), { recursive: true });
    await Bun.write(options.out, `${JSON.stringify(presents, null, 2)}\n`);

    const hosts = new Map<string, number>();
    for (const present of presents) hosts.set(present.host, (hosts.get(present.host) ?? 0) + 1);
    const summary = [...hosts].map(([host, n]) => `${host}=${n}`).join(", ");
    console.log(`${presents.length} presentations (${summary}) -> ${options.out}`);
  });

if (import.meta.main) {
  await program.parseAsync();
}
