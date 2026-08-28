#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../../packages/decode/index";

// Mine review-comment bodies out of the Claude Code session index. The bodies
// posted on GitLab MRs never land inline in the `glab`/`draft-note` commands
// (they arrive via `--input file.json` or `body=@file.md`), so the recoverable
// text lives in the Write tool calls that produced those payload files.

const argv = cli({
  name: "mine",
  flags: {
    db: {
      type: String,
      description: "session.duckdb path (defaults to the session skill's data dir)",
    },
    out: {
      type: String,
      default: join(import.meta.dirname, "..", "data", "candidates.json"),
      description: "Where to write the candidate set",
    },
    host: { type: String, description: "Limit to one host label (e.g. work, local)" },
    minChars: { type: Number, default: 20, description: "Drop bodies shorter than this" },
  },
});

function resolveDbPath(): string {
  if (argv.flags.db) return argv.flags.db;
  const dataDir =
    process.env.CLAUDE_PLUGIN_DATA || join(process.env.TMPDIR || "/tmp", "claude-session");
  return join(dataDir, "session.duckdb");
}

const WriteRow = z.looseObject({
  host: z.string(),
  session_id: z.string(),
  timestamp: z.string(),
  file_path: z.string(),
  content: z.string(),
});
type WriteRow = z.infer<typeof WriteRow>;

const ReviewPayload = z.union([
  z.array(z.unknown()),
  z.looseObject({ comments: z.array(z.unknown()) }).transform((value) => value.comments),
  z.looseObject({ notes: z.array(z.unknown()) }).transform((value) => value.notes),
]);

const Comment = z.looseObject({
  body: z.string().optional().catch(undefined),
  comment: z.string().optional().catch(undefined),
  text: z.string().optional().catch(undefined),
  file: z.string().optional().catch(undefined),
  path: z.string().optional().catch(undefined),
  line: z.number().optional().catch(undefined),
});

interface Candidate {
  id: string;
  host: string;
  session_id: string;
  timestamp: string;
  workdir: string;
  source: string;
  file: string | null;
  line: number | null;
  body: string;
}

const SQL = `
SELECT host, session_id, timestamp,
  (data->'$.input'->>'file_path') AS file_path,
  (data->'$.input'->>'content')   AS content
FROM content_items
WHERE type = 'tool_use' AND name = 'Write'
  AND (data->'$.input'->>'file_path') IS NOT NULL
  AND (data->'$.input'->>'content')   IS NOT NULL
  AND (data->'$.input'->>'file_path') ILIKE '%/tmp%'
  AND (
       (data->'$.input'->>'file_path') ILIKE '%review%'
    OR (data->'$.input'->>'file_path') ILIKE '%/replies/%'
    OR (data->'$.input'->>'file_path') ILIKE '%reply%'
    OR (data->'$.input'->>'file_path') ILIKE '%discussion%'
    OR (data->'$.input'->>'file_path') ILIKE '%/notes/%'
  )
ORDER BY timestamp
`;

async function queryRows(dbPath: string): Promise<WriteRow[]> {
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", dbPath], {
    stdin: new TextEncoder().encode(SQL),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`duckdb failed (${code}): ${err.trim()}`);
  const trimmed = out.trim();
  if (!trimmed) return [];
  return decodeJson(z.array(WriteRow), trimmed, `duckdb ${dbPath}`);
}

function isText(fp: string): "json" | "md" | null {
  const lower = fp.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "md";
  return null;
}

function workdirOf(fp: string): string {
  const idx = fp.indexOf("/tmp");
  const dir = idx > 0 ? fp.slice(0, idx) : dirname(fp);
  return basename(dir) || dir;
}

function bodiesFromJson(
  content: string,
): Array<{ body: string; file: string | null; line: number | null }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const items = ReviewPayload.safeParse(parsed);
  if (!items.success) return [];

  const out: Array<{ body: string; file: string | null; line: number | null }> = [];
  for (const item of items.data) {
    if (typeof item === "string") {
      out.push({ body: item, file: null, line: null });
      continue;
    }
    const comment = Comment.safeParse(item);
    if (!comment.success) continue;
    const body = comment.data.body ?? comment.data.comment ?? comment.data.text;
    if (body === undefined) continue;
    out.push({
      body,
      file: comment.data.file ?? comment.data.path ?? null,
      line: comment.data.line ?? null,
    });
  }
  return out;
}

function idFor(host: string, session: string, fp: string, index: number): string {
  const hash = createHash("sha1")
    .update(`${host}:${session}:${fp}:${index}`)
    .digest("hex")
    .slice(0, 10);
  return `${host}-${hash}`;
}

function normalize(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase();
}

async function main() {
  const dbPath = resolveDbPath();
  if (!(await Bun.file(dbPath).exists())) {
    console.error(`No session index at ${dbPath}.`);
    console.error("Build it first: bun plugins/claude-code/skills/session/scripts/refresh.ts");
    process.exit(1);
  }

  const rows = await queryRows(dbPath);
  const hostFilter = argv.flags.host;

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (hostFilter && row.host !== hostFilter) continue;
    const kind = isText(row.file_path);
    if (!kind) continue;

    const extracted =
      kind === "json"
        ? bodiesFromJson(row.content)
        : [{ body: row.content, file: null, line: null }];

    extracted.forEach((entry, index) => {
      const body = entry.body.trim();
      if (body.length < argv.flags.minChars) return;
      const key = normalize(body);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        id: idFor(row.host, row.session_id, row.file_path, index),
        host: row.host,
        session_id: row.session_id,
        timestamp: row.timestamp,
        workdir: workdirOf(row.file_path),
        source: basename(row.file_path),
        file: entry.file,
        line: entry.line,
        body,
      });
    });
  }

  await mkdir(dirname(argv.flags.out), { recursive: true });
  await Bun.write(argv.flags.out, `${JSON.stringify(candidates, null, 2)}\n`);

  const byHost = candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.host] = (acc[c.host] ?? 0) + 1;
    return acc;
  }, {});

  if (candidates.length === 0) {
    console.log("No review-comment candidates found in the session index.");
    console.log("Check that the source machine's history is imported (session skill hosts.ts).");
    return;
  }

  console.log(`Wrote ${candidates.length} candidates to ${argv.flags.out}`);
  for (const [host, n] of Object.entries(byHost)) console.log(`  ${host}: ${n}`);
}

main();
