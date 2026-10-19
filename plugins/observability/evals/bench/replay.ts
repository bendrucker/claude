import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { median, medianAbsoluteDeviation, standardDeviation } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { pValue } from "../../../../packages/evals/stats";
import { loadQueryHeaders, parseQueryHeader } from "../../skills/session/scripts/query-header";
import { normalize, statements } from "./sql";

export const SKILL = join(import.meta.dirname, "..", "..", "skills", "session");

/** Appended to limits.sql: the cloud VM readers' cap. */
const LIMITS = {
  mac: "",
  vm: "SET memory_limit = '450MB';\nSET threads = 1;\n",
} as const;
type Limits = keyof typeof LIMITS;

/** Each gets its most frequent query into the replay set. */
const COVER = [
  "sessions",
  "message_usage",
  "text_content",
  "tool_calls",
  "content_items",
  "tool_errors",
  "hook_events",
  "search",
  "index-health",
  "skill-config-vs-observed",
  "hook-blocks",
  "delegation",
];

export const Query = z.object({
  id: z.string(),
  name: z.string().optional(),
  sql: z.string(),
  count: z.number(),
  sessions: z.number(),
  ooms: z.number(),
  last: z.string(),
  covers: z.array(z.string()),
});
export type Query = z.infer<typeof Query>;

export interface Arm {
  name: string;
  db: string;
  skill: string;
}

/** Rotating arm order spreads drift within a round across every arm. */
export function rotate<T>(arms: T[], n: number): T[] {
  const k = n % arms.length;
  return [...arms.slice(k), ...arms.slice(0, k)];
}

const METRICS = ["latency", "bytesRead", "rowsScanned", "peakBuffer", "rss", "size"] as const;
type Metrics = Partial<Record<(typeof METRICS)[number], number | undefined>>;

interface Measured extends Metrics {
  wall: number;
  exit: number;
  oom?: boolean;
  timeout?: boolean;
  error?: string | undefined;
}

export interface Sample extends Measured {
  query: string;
  limits: Limits;
  arm: string;
  /** The first arm, which every other arm is compared against. */
  base: boolean;
  run: number;
}

/** Runs a process to exit, timing it from outside and reading its peak memory. */
export async function timed(
  cmd: string[],
  options: Parameters<typeof Bun.spawn>[1] = {},
): Promise<{ wall: number; exit: number; rss: number | undefined; stderr: string }> {
  const start = performance.now();
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "inherit", ...options });
  const [stderr, exit] = await Promise.all([
    proc.stderr instanceof ReadableStream ? new Response(proc.stderr).text() : "",
    proc.exited,
  ]);
  return {
    wall: (performance.now() - start) / 1000,
    exit,
    rss: proc.resourceUsage()?.maxRSS,
    stderr,
  };
}

const byArm = (samples: Sample[]) =>
  [...Map.groupBy(samples, (s) => s.arm)].toSorted(
    ([, a], [, b]) => Number(b[0]?.base) - Number(a[0]?.base),
  );

export async function duckdbJson<T>(db: string, sql: string, schema: z.ZodType<T>): Promise<T[]> {
  const init = "SET memory_limit = '1GB';";
  const out = await $`duckdb -readonly -json -cmd ${init} ${db} < ${Buffer.from(sql)}`.text();
  // The CLI renders an empty result as `[{]`.
  const rows = out.trim();
  return z.array(schema).parse(rows === "" || rows === "[{]" ? [] : JSON.parse(rows));
}

const MINE = String.raw`
SELECT tc.timestamp::VARCHAR AS ts, tc.session_id, tc.command,
  (coalesce(CAST(r.content AS VARCHAR), '') ILIKE '%out of memory%')::INTEGER AS oom
FROM tool_calls tc
LEFT JOIN content_items r
  ON r.type = 'tool_result' AND r.host = tc.host AND r.tool_use_id = tc.tool_id
WHERE tc.tool_name = 'Bash'
  AND tc.command LIKE '%duckdb%'
  AND regexp_matches(tc.command, 'session\.duckdb|claude-sessions|refresh\.ts|/session/resources')
`;
const Mined = z.object({
  ts: z.string(),
  session_id: z.string(),
  command: z.string(),
  oom: z.number(),
});

/** Every group that ran out of memory, the top group per hot surface, then the most frequent. */
export async function replaySet(db: string, top: number): Promise<Query[]> {
  const rows = await duckdbJson(db, MINE, Mined);
  // A named query the skill no longer ships cannot be replayed.
  const known = new Set((await loadQueryHeaders()).map((h) => h.name));
  const groups = new Map<string, Query & { ids: Set<string> }>();
  const calls = rows
    .toSorted((a, b) => a.ts.localeCompare(b.ts))
    .flatMap((row) => statements(row.command).map((s) => ({ row, s })))
    .filter(({ s }) => s.name === undefined || known.has(s.name));
  for (const { row, s } of calls) {
    const key = s.name === undefined ? normalize(s.sql) : `named:${s.name}`;
    const g = groups.get(key) ?? {
      id: s.name ?? `q${new Bun.CryptoHasher("sha1").update(key).digest("hex").slice(0, 8)}`,
      name: s.name,
      sql: "",
      count: 0,
      sessions: 0,
      ooms: 0,
      last: "",
      covers: COVER.filter((c) => s.name === c || new RegExp(`\\b${c}\\b`).test(key)),
      ids: new Set<string>(),
    };
    g.ids.add(row.session_id);
    g.count++;
    g.ooms += row.oom;
    g.sql = s.sql;
    g.last = row.ts;
    groups.set(key, g);
  }
  const ranked = [...groups.values()].toSorted((a, b) => b.count - a.count);
  const picked = new Set(ranked.filter((g) => g.ooms > 0).slice(0, 10));
  for (const c of COVER) {
    const g = ranked.find((r) => r.covers.includes(c));
    if (g) picked.add(g);
  }
  for (const g of ranked) if (picked.size < top) picked.add(g);
  return [...picked]
    .map(({ ids, ...q }) => Object.assign(q, { sessions: ids.size }))
    .toSorted((a, b) => b.count - a.count);
}

const Profile = z.looseObject({
  latency: z.number(),
  total_bytes_read: z.number().optional(),
  cumulative_rows_scanned: z.number().optional(),
  system_peak_buffer_memory: z.number().optional(),
});

// Built once per arm, query and limit: the schedule replays each thousands of times.
const prepared = new Map<string, Promise<{ sql: string; init: string; disk: boolean }>>();

/** A named query's header says whether it reads from disk through extensions.sql. */
async function prepare(q: Query, a: Arm, limits: Limits, dir: string) {
  const named =
    q.name === undefined
      ? undefined
      : await Bun.file(join(a.skill, "resources", "queries", `${q.name}.sql`)).text();
  const disk = named !== undefined && parseQueryHeader(named).extensions.length > 0;
  const limitsFile = join(a.skill, "resources", disk ? "extensions.sql" : "limits.sql");
  const init = join(dir, `init-${a.name}-${limits}-${disk ? "ext" : "idx"}.sql`);
  await Bun.write(init, (await Bun.file(limitsFile).text()) + LIMITS[limits]);
  return { sql: named === undefined ? q.sql : `${q.sql}\n${named}`, init, disk };
}

/**
 * A named query reads its SQL from the arm's skill directory, so a candidate checkout replays its
 * own. The profile covers only the last statement, after any SET VARIABLE lines.
 */
export async function replay(
  q: Query,
  a: Arm,
  limits: Limits,
  dir: string,
  timeoutMs: number,
): Promise<Measured> {
  const key = `${q.id} ${a.name} ${limits}`;
  const ready = prepared.get(key) ?? prepare(q, a, limits, dir);
  prepared.set(key, ready);
  const { sql, init, disk } = await ready;
  const profile = Bun.file(join(dir, "profile.json"));
  await profile.delete().catch(() => undefined);
  const stdin = `PRAGMA enable_profiling = 'json';\nPRAGMA profiling_output = '${profile.name}';\n${sql}\n`;
  const signal = AbortSignal.timeout(timeoutMs);
  const { wall, exit, rss, stderr } = await timed(
    ["duckdb", "-readonly", "-json", "-init", init, a.db],
    {
      stdin: Buffer.from(stdin),
      stderr: "pipe",
      // Disk queries read globs such as .claude/skills relative to where agents ran them.
      cwd: disk ? homedir() : dir,
      signal,
    },
  );
  // The CLI can print an error and still exit 0.
  const error = /\b\w+ Error:.*/.exec(stderr)?.[0];
  const parsed = Profile.safeParse(await profile.json().catch(() => null));
  const p = parsed.success ? parsed.data : undefined;
  return {
    wall,
    exit: error !== undefined && exit === 0 ? 1 : exit,
    oom: /out of memory/i.test(stderr),
    timeout: signal.aborted,
    error,
    rss,
    latency: p?.latency,
    bytesRead: p?.total_bytes_read,
    rowsScanned: p?.cumulative_rows_scanned,
    peakBuffer: p?.system_peak_buffer_memory,
    size: Bun.file(a.db).size,
  };
}

/** In hyperfine's export format, which `performance:benchmark`'s compare.ts reads. */
export async function writeExport(path: string, samples: Sample[]): Promise<void> {
  // compare.ts takes the first result as its base.
  const results = byArm(samples).map(([name, runs]) => ({
    command: name,
    name,
    measurements: runs.map((s) => ({
      time_wall_clock: { value: s.wall },
      ...(s.rss !== undefined && { memory_peak_resident: { value: s.rss } }),
      exit_code: s.exit,
    })),
  }));
  await Bun.write(path, JSON.stringify({ schema_version: 2, results }, null, 2));
}

const passing = (rs: Sample[]) => rs.filter((s) => s.exit === 0).map((s) => s.wall);
const mid = (xs: (number | undefined)[]) => {
  const ns = xs.filter((x) => x !== undefined);
  return ns.length > 0 ? median(ns) : undefined;
};

interface Row extends Metrics {
  group: string;
  arm: string;
  n: number;
  wall: number;
  mad: number;
  floor: number;
  change?: number | undefined;
  p?: number | undefined;
  significant: boolean;
  ooms: number;
  failures: number;
}

/** A change counts when p < 0.1 and it clears max(2σ of the base, 10% of its median). */
export function summarize(samples: Sample[], key: (s: Sample) => string): Row[] {
  return [...Map.groupBy(samples, key)].flatMap(([group, rows]) => {
    const arms = byArm(rows);
    const base = passing(arms[0]?.[1] ?? []);
    const baseMedian = base.length > 0 ? median(base) : Number.NaN;
    const floor = Math.max(base.length > 1 ? 2 * standardDeviation(base) : 0, 0.1 * baseMedian);
    return arms.map(([arm, rs], i): Row => {
      const walls = passing(rs);
      const wall = walls.length > 0 ? median(walls) : Number.NaN;
      const p = i === 0 || walls.length === 0 ? undefined : pValue(base, walls);
      const metrics = Object.fromEntries(METRICS.map((k) => [k, mid(rs.map((s) => s[k]))]));
      return Object.assign(metrics, {
        group,
        arm,
        n: walls.length,
        wall,
        mad: walls.length > 0 ? medianAbsoluteDeviation(walls) / wall : Number.NaN,
        floor,
        change: i === 0 ? undefined : (wall - baseMedian) / baseMedian,
        p,
        significant: p !== undefined && p < 0.1 && Math.abs(wall - baseMedian) >= floor,
        ooms: rs.filter((s) => s.oom).length,
        failures: rs.length - walls.length,
      });
    });
  });
}

const mb = (n: number | undefined) => (n === undefined ? "-" : (n / 2 ** 20).toFixed(0));
const sec = (n: number | undefined) => {
  if (n === undefined || Number.isNaN(n)) return "-";
  return n < 1 ? `${(n * 1000).toFixed(0)}ms` : `${n.toFixed(2)}s`;
};
const pct = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "" : `${(n * 100).toFixed(0)}%`;

const HEADER = [
  "group",
  "arm",
  "n",
  "wall",
  "±MAD",
  "floor",
  "Δ",
  "p",
  "engine",
  "MB read",
  "rows scanned",
  "buffer MB",
  "RSS MB",
  "index MB",
  "OOM",
  "failed",
];

export function render(rows: Row[]): string {
  return table([
    HEADER,
    ...rows.map((r) => [
      r.group,
      r.arm,
      r.n,
      sec(r.wall),
      pct(r.mad),
      sec(r.floor),
      `${pct(r.change)}${r.significant ? "*" : ""}`,
      r.p === undefined ? "" : r.p.toFixed(3),
      sec(r.latency),
      mb(r.bytesRead),
      r.rowsScanned ?? "-",
      mb(r.peakBuffer),
      mb(r.rss),
      mb(r.size),
      r.ooms,
      r.failures,
    ]),
  ]);
}
