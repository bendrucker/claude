#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../../../../packages/decode/index";
import { classifyResponse, type Present } from "./decisions";

// Mine every ExitPlanMode presentation since the gate switched to deny (#1216,
// 2026-08-15): the plan text, the response the call received, and the model that
// wrote it. Both hosts land in data/, which is gitignored: the replay needs the
// full history for fidelity, and the rework runner filters to host = 'local'
// before any plan text reaches a model.

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
  if (db !== undefined) return db;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  const dataDir =
    pluginData !== undefined && pluginData !== ""
      ? join(dirname(pluginData), "claude-code-bendrucker")
      : join(process.env.HOME ?? "", ".claude", "plugins", "data", "claude-code-bendrucker");
  return join(dataDir, "session.duckdb");
}

async function queryPresents(dbPath: string, since: string): Promise<Present[]> {
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", dbPath, "-c", sql(since)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`duckdb failed (exit ${code})\n${stderr}`);
  const text = stdout.trim();
  if (text === "") return [];
  return decodeJson(z.array(MinedRow), text, `duckdb ${dbPath}`).map(toPresent);
}

if (import.meta.main) {
  const argv = cli({
    name: "mine",
    help: { description: "Mine ExitPlanMode presentations from the session index." },
    flags: {
      db: {
        type: String,
        description: "session.duckdb path (defaults to the session skill's data dir)",
      },
      since: { type: String, default: DEFAULT_SINCE, description: "Earliest presentation date" },
      out: {
        type: String,
        default: join(import.meta.dirname, "..", "data", "presents.json"),
        description: "Output path",
      },
    },
  });

  const dbPath = resolveDbPath(argv.flags.db);
  if (!(await Bun.file(dbPath).exists())) {
    console.error(`No session index at ${dbPath}. Run the claude-code:session refresh first.`);
    process.exit(1);
  }
  const presents = await queryPresents(dbPath, argv.flags.since);
  await mkdir(dirname(argv.flags.out), { recursive: true });
  await Bun.write(argv.flags.out, `${JSON.stringify(presents, null, 2)}\n`);

  const hosts = new Map<string, number>();
  for (const present of presents) hosts.set(present.host, (hosts.get(present.host) ?? 0) + 1);
  const summary = [...hosts].map(([host, n]) => `${host}=${n}`).join(", ");
  console.log(`${presents.length} presentations (${summary}) -> ${argv.flags.out}`);
}
