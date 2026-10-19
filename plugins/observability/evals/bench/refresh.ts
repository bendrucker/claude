import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import type { Manifest } from "../../skills/session/scripts/db";
import { type Arm, duckdbJson, rotate, type Sample, timed } from "./replay";

const ONCE = join(import.meta.dirname, "refresh-once.ts");

async function clone(from: string, to: string): Promise<void> {
  await Bun.file(to)
    .delete()
    .catch(() => undefined);
  await (process.platform === "darwin"
    ? $`cp -c ${from} ${to}`
    : $`cp --reflink=auto ${from} ${to}`);
}

async function refreshOnce(a: Arm, dataDir: string, importsDir: string) {
  const { wall, exit, rss } = await timed(["bun", ONCE, a.skill, dataDir, importsDir]);
  return { wall, exit, rss };
}

/**
 * Copies real transcripts near the target size under a throwaway import host, so a refresh
 * re-reads them while the local host's files stay out of reach: never scanned, reaped, or written.
 */
async function stage(db: string, rows: number, files: number, dir: string) {
  const picked = await duckdbJson(
    db,
    `SELECT source_file FROM raw WHERE host = 'local' GROUP BY 1
     HAVING count(*) BETWEEN ${Math.floor(rows * 0.9)} AND ${Math.ceil(rows * 1.1)}
     ORDER BY hash(source_file) LIMIT ${files}`,
    z.object({ source_file: z.string() }),
  );
  if (picked.length < files) throw new Error(`only ${picked.length} transcripts near ${rows} rows`);
  const projects = join(dir, "bench", "projects", "bench");
  mkdirSync(projects, { recursive: true });
  const manifest: Manifest = {
    host: "bench",
    source: "bench",
    imported_at: "",
    policy: { block_egress: true },
  };
  await Bun.write(join(dir, "bench", "manifest.json"), JSON.stringify(manifest));
  return Promise.all(
    picked.map(async (f, i) => {
      const path = join(projects, `${i}.jsonl`);
      const text = (await Bun.file(f.source_file).text()).trimEnd();
      await Bun.write(path, `${text}\n`);
      return { path, text: `${text}\n`, last: `${text.slice(text.lastIndexOf("\n") + 1)}\n` };
    }),
  );
}

/** Times an incremental refresh after `files` transcripts of about `rows` rows change. */
export async function refresh(o: {
  arms: Arm[];
  rows: number;
  files: number;
  runs: number;
  dir: string;
}): Promise<Sample[]> {
  const imports = join(o.dir, `imports-${o.rows}`);
  const staged = await stage(o.arms[0]?.db ?? "", o.rows, o.files, imports);
  const arms = await Promise.all(
    o.arms.map(async (a, i) => {
      const setup = join(o.dir, a.name, `setup-${o.rows}`);
      mkdirSync(setup, { recursive: true });
      await clone(a.db, join(setup, "session.duckdb"));
      return { a, setup, base: i === 0 };
    }),
  );
  for (const { a, setup } of arms) {
    // oxlint-disable-next-line no-await-in-loop -- setups run one at a time: each refresh is a writer that takes the machine's memory budget.
    const first = await refreshOnce(a, setup, imports);
    if (first.exit !== 0) throw new Error(`${a.name}: setup refresh exited ${first.exit}`);
  }
  const samples: Sample[] = [];
  for (let run = 0; run < o.runs; run++) {
    // A copy of each transcript's last line, the change a live session makes.
    // oxlint-disable-next-line no-await-in-loop -- a benchmark round must finish before the next starts.
    await Promise.all(staged.map((f) => Bun.write(f.path, (f.text += f.last))));
    for (const { a, setup, base } of rotate(arms, run)) {
      const dir = join(o.dir, a.name, `run-${o.rows}`);
      mkdirSync(dir, { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- refreshes are timed one at a time.
      await clone(join(setup, "session.duckdb"), join(dir, "session.duckdb"));
      // oxlint-disable-next-line no-await-in-loop -- refreshes are timed one at a time.
      const r = await refreshOnce(a, dir, imports);
      samples.push({
        query: `refresh-${o.rows}x${o.files}`,
        limits: "mac",
        arm: a.name,
        base,
        run,
        ...r,
        size: Bun.file(join(dir, "session.duckdb")).size,
      });
    }
  }
  return samples;
}
