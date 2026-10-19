import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { type Arm, duckdbJson, rotate, type Sample } from "./replay";

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
  const start = performance.now();
  const proc = Bun.spawn(["bun", ONCE, a.skill, dataDir, importsDir], { stderr: "inherit" });
  const exit = await proc.exited;
  return { wall: (performance.now() - start) / 1000, exit, rss: proc.resourceUsage()?.maxRSS };
}

/**
 * Copies real transcripts near the target size under a throwaway import host, so a refresh
 * re-reads them while the local host's files stay out of reach: never scanned, reaped, or written.
 */
async function stage(db: string, rows: number, files: number, dir: string): Promise<string[]> {
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
  const manifest = {
    host: "bench",
    source: "bench",
    imported_at: "",
    policy: { block_egress: true },
  };
  await Bun.write(join(dir, "bench", "manifest.json"), JSON.stringify(manifest));
  const paths = picked.map((_f, i) => join(projects, `${i}.jsonl`));
  await Promise.all(picked.map((f, i) => Bun.write(paths[i] ?? "", Bun.file(f.source_file))));
  return paths;
}

/** Appends a copy of each transcript's last line, the change a live session makes. */
async function touch(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (p) => {
      const text = (await Bun.file(p).text()).trimEnd();
      await Bun.write(p, `${text}\n${text.slice(text.lastIndexOf("\n") + 1)}\n`);
    }),
  );
}

export interface RefreshOptions {
  arms: Arm[];
  rows: number;
  files: number;
  runs: number;
  dir: string;
}

/** Times an incremental refresh after `files` transcripts of about `rows` rows change. */
export async function refresh(o: RefreshOptions): Promise<Sample[]> {
  const imports = join(o.dir, `imports-${o.rows}`);
  const paths = await stage(o.arms[0]?.db ?? "", o.rows, o.files, imports);
  const setups = await Promise.all(
    o.arms.map(async (a) => {
      const setup = join(o.dir, a.name, `setup-${o.rows}`);
      mkdirSync(setup, { recursive: true });
      await clone(a.db, join(setup, "session.duckdb"));
      return setup;
    }),
  );
  for (const [i, a] of o.arms.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- setups run one at a time: each refresh is a writer that takes the machine's memory budget.
    const first = await refreshOnce(a, setups[i] ?? "", imports);
    if (first.exit !== 0) throw new Error(`${a.name}: setup refresh exited ${first.exit}`);
  }
  const schedule = Array.from({ length: o.runs }, (_, run) =>
    rotate(o.arms, run).map((a) => ({ run, a })),
  );
  const samples: Sample[] = [];
  for (const round of schedule) {
    // oxlint-disable-next-line no-await-in-loop -- a benchmark round must finish before the next starts.
    await touch(paths);
    for (const { run, a } of round) {
      const k = o.arms.indexOf(a);
      const dir = join(o.dir, a.name, `run-${o.rows}`);
      mkdirSync(dir, { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- refreshes are timed one at a time.
      await clone(join(setups[k] ?? "", "session.duckdb"), join(dir, "session.duckdb"));
      // oxlint-disable-next-line no-await-in-loop -- refreshes are timed one at a time.
      const r = await refreshOnce(a, dir, imports);
      samples.push({
        query: `refresh-${o.rows}x${o.files}`,
        limits: "mac",
        arm: a.name,
        base: k === 0,
        run,
        ...r,
        oom: false,
        timeout: false,
        size: Bun.file(join(dir, "session.duckdb")).size,
      });
    }
  }
  return samples;
}
