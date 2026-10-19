import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { duckdbJson } from "./replay";

// A session's subagent transcripts sit in a directory named for it, so sampling by this key keeps
// a fan-out whole.
const SESSION = String.raw`coalesce(nullif(regexp_extract(source_file, '/projects/[^/]+/([0-9a-f-]{36})', 1), ''), source_file)`;

const pick = (fraction: number) => `
WITH files AS (
  SELECT source_file, ${SESSION} AS unit, sum(strlen(data::VARCHAR)) AS bytes, min(timestamp) AS ts
  FROM raw WHERE host = 'local' GROUP BY source_file
), units AS (
  SELECT unit, sum(bytes) AS bytes, strftime(min(ts), '%Y-%m') AS month FROM files GROUP BY unit
), ranked AS (
  SELECT unit, sum(bytes) OVER (PARTITION BY month ORDER BY hash(unit) ROWS UNBOUNDED PRECEDING) AS running,
    sum(bytes) OVER (PARTITION BY month) AS month_bytes
  FROM units
)
SELECT row_number() OVER () AS id, source_file FROM files JOIN ranked USING (unit)
WHERE running <= month_bytes * ${fraction}
`;

function commonDir(paths: string[]): string {
  const [first = ""] = paths;
  let end = first.lastIndexOf("/") + 1;
  for (const p of paths)
    while (!p.startsWith(first.slice(0, end))) end = first.lastIndexOf("/", end - 2) + 1;
  return first.slice(0, end);
}

/**
 * Writes a sample of the index's local transcripts back out as JSONL, from `raw.data`, so arms can
 * be rebuilt from it where the transcripts themselves are out of reach. Sessions are sampled
 * within each month in proportion to its bytes, up to `bytes` in all.
 */
export async function snapshot(db: string, out: string, bytes: number): Promise<number> {
  const [total] = await duckdbJson(
    db,
    "SELECT sum(strlen(data::VARCHAR))::DOUBLE AS n FROM raw WHERE host = 'local'",
    z.object({ n: z.number() }),
  );
  const fraction = Math.min(1, bytes / (total?.n ?? 1));
  const files = await duckdbJson(
    db,
    pick(fraction),
    z.object({ id: z.number(), source_file: z.string() }),
  );
  const staging = join(out, ".staging");
  mkdirSync(out, { recursive: true });
  const ids = files.map((f) => `(${f.id}, '${f.source_file.replaceAll("'", "''")}')`).join(",");
  // Lines go out unchanged: quoting and the header are off, and the delimiter never occurs in JSON.
  await duckdbJson(
    db,
    `COPY (SELECT r.data, f.id FROM raw r JOIN (VALUES ${ids}) f(id, source_file) USING (source_file)
           WHERE r.host = 'local' AND r.data IS NOT NULL ORDER BY f.id, r.source_line)
     TO '${staging}' (FORMAT csv, HEADER false, QUOTE '', ESCAPE '', DELIMITER '\x01', PARTITION_BY id, OVERWRITE)`,
    z.unknown(),
  );
  const root = commonDir(files.map((f) => f.source_file));
  const moves = files.map((f) => {
    const target = join(out, "projects", f.source_file.slice(root.length));
    mkdirSync(dirname(target), { recursive: true });
    const [part = ""] = readdirSync(join(staging, `id=${f.id}`));
    return `mv ${$.escape(join(staging, `id=${f.id}`, part))} ${$.escape(target)}`;
  });
  await $`sh -s < ${Buffer.from(moves.join("\n"))}`;
  await $`rm -rf ${staging}`;
  return files.length;
}
