import { join } from "node:path";
import { $ } from "bun";
import { median, medianAbsoluteDeviation, standardDeviation } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { pValue } from "../../../../packages/evals/stats";
import { normalize, statements } from "./sql";

export const SKILL = join(import.meta.dirname, "..", "..", "skills", "session");

/** Per-process ceilings appended to limits.sql: the Mac keeps it unchanged, the VM gets its readers' cap. */
export const LIMITS = {
  mac: "",
  vm: "SET memory_limit = '450MB';\nSET threads = 1;\n",
} as const;
export type Limits = keyof typeof LIMITS;

/** Surfaces the replay set must cover, so no hot path drops out for being less frequent. */
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

/** The arms in round `n`'s order, so drift within a round lands on every arm alike. */
export function rotate<T>(arms: T[], n: number): T[] {
  const k = n % arms.length;
  return [...arms.slice(k), ...arms.slice(0, k)];
}

export interface Sample {
  query: string;
  limits: Limits;
  arm: string;
  /** The first arm, which every other arm is compared against. */
  base: boolean;
  run: number;
  wall: number;
  exit: number;
  oom: boolean;
  timeout: boolean;
  error?: string | undefined;
  rss?: number | undefined;
  latency?: number | undefined;
  bytesRead?: number | undefined;
  rowsScanned?: number | undefined;
  peakBuffer?: number | undefined;
  size?: number | undefined;
}
export type Measured = Omit<Sample, "query" | "limits" | "arm" | "base" | "run">;

/** Runs SQL read-only under a 1 GB cap, small enough for a reader beside the VM's agents. */
export async function duckdbJson<T>(db: string, sql: string, schema: z.ZodType<T>): Promise<T[]> {
  const init = "SET memory_limit = '1GB'; SET threads = 1;";
  const out = await $`duckdb -readonly -json -cmd ${init} ${db} < ${Buffer.from(sql)}`.text();
  // The CLI renders an empty result as `[{]`.
  const rows = out.trim();
  return z.array(schema).parse(rows === "" || rows === "[{]" ? [] : JSON.parse(rows));
}

const MINE = String.raw`
SELECT tc.timestamp::VARCHAR AS ts, tc.session_id, tc.command,
  coalesce(CAST(r.content AS VARCHAR), '') ILIKE '%out of memory%' AS oom
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
  oom: z.boolean(),
});

/**
 * Mines the index for the SQL agents ran against it, grouped by normalized text, and keeps the
 * most frequent groups after every group that ran out of memory and the top group per hot surface.
 */
export async function replaySet(db: string, top: number): Promise<Query[]> {
  const rows = await duckdbJson(db, MINE, Mined);
  const groups = new Map<string, Query & { ids: Set<string> }>();
  const calls = rows
    .toSorted((a, b) => a.ts.localeCompare(b.ts))
    .flatMap((row) => statements(row.command).map((s) => ({ row, s })));
  for (const { row, s } of calls) {
    const key = s.name === undefined ? normalize(s.sql) : `named:${s.name}`;
    const g = groups.get(key) ?? {
      id: s.name ?? `q${new Bun.CryptoHasher("sha1").update(key).digest("hex").slice(0, 8)}`,
      ...(s.name !== undefined && { name: s.name }),
      sql: s.sql,
      count: 0,
      sessions: 0,
      ooms: 0,
      last: row.ts,
      covers: COVER.filter((c) => s.name === c || new RegExp(`\\b${c}\\b`).test(key)),
      ids: new Set<string>(),
    };
    g.ids.add(row.session_id);
    Object.assign(g, {
      count: g.count + 1,
      ooms: g.ooms + Number(row.oom),
      sessions: g.ids.size,
      sql: s.sql,
      last: row.ts,
    });
    groups.set(key, g);
  }
  const ranked = [...groups.values()].toSorted((a, b) => b.count - a.count);
  const picked = new Set(ranked.filter((g) => g.ooms > 0).slice(0, 10));
  for (const c of COVER) {
    const g = ranked.find((r) => r.covers.includes(c));
    if (g) picked.add(g);
  }
  for (const g of ranked) if (picked.size < top) picked.add(g);
  return [...picked].map(({ ids: _, ...q }) => q).toSorted((a, b) => b.count - a.count);
}

const Profile = z.looseObject({
  latency: z.number(),
  total_bytes_read: z.number().optional(),
  cumulative_rows_scanned: z.number().optional(),
  system_peak_buffer_memory: z.number().optional(),
});

async function sqlFor(q: Query, skill: string): Promise<string> {
  if (q.name === undefined) return q.sql;
  return `${q.sql}\n${await Bun.file(join(skill, "resources", "queries", `${q.name}.sql`)).text()}`;
}

/**
 * One replay of one query in a fresh read-only process, as an agent's Bash call runs it. A named
 * query reads its SQL from the arm's skill directory, so a candidate checkout replays its own.
 * The profile covers the last statement, which is the query proper after any SET VARIABLE lines.
 */
export async function replay(
  q: Query,
  a: Arm,
  limits: Limits,
  dir: string,
  timeoutMs: number,
): Promise<Measured> {
  const sql = await sqlFor(q, a.skill);
  const disk = q.name !== undefined && /markdown|yaml/i.test(sql);
  const limitsFile = join(a.skill, "resources", disk ? "extensions.sql" : "limits.sql");
  const init = join(dir, `init-${a.name}-${limits}-${disk ? "ext" : "idx"}.sql`);
  await Bun.write(init, (await Bun.file(limitsFile).text()) + LIMITS[limits]);
  const profile = Bun.file(join(dir, "profile.json"));
  await profile.delete().catch(() => undefined);
  const stdin = `PRAGMA enable_profiling = 'json';\nPRAGMA profiling_output = '${profile.name}';\n${sql}\n`;
  const signal = AbortSignal.timeout(timeoutMs);
  const start = performance.now();
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", "-init", init, a.db], {
    stdin: Buffer.from(stdin),
    stdout: "ignore",
    stderr: "pipe",
    signal,
  });
  const [stderr, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  const wall = (performance.now() - start) / 1000;
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
    rss: proc.resourceUsage()?.maxRSS,
    latency: p?.latency,
    bytesRead: p?.total_bytes_read,
    rowsScanned: p?.cumulative_rows_scanned,
    peakBuffer: p?.system_peak_buffer_memory,
    size: Bun.file(a.db).size,
  };
}

/** A hyperfine 2 export per group, so `performance:benchmark`'s compare.ts can pool and test it. */
export async function writeExport(path: string, samples: Sample[]): Promise<void> {
  // compare.ts takes the first result as its base.
  const arms = [...Map.groupBy(samples, (s) => s.arm)].toSorted(
    ([, a], [, b]) => Number(b[0]?.base) - Number(a[0]?.base),
  );
  const results = arms.map(([name, runs]) => ({
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

export interface Row {
  group: string;
  arm: string;
  n: number;
  wall: number;
  mad: number;
  floor: number;
  change?: number | undefined;
  p?: number | undefined;
  significant: boolean;
  latency?: number | undefined;
  bytesRead?: number | undefined;
  rowsScanned?: number | undefined;
  peakBuffer?: number | undefined;
  rss?: number | undefined;
  size?: number | undefined;
  ooms: number;
  failures: number;
}

/**
 * Per group and arm: medians and spread, and each arm's change against the base. A change counts
 * when its permutation p is below 0.1 and it clears the noise floor: 2σ of the base or 10% of its
 * median, whichever is larger.
 */
export function summarize(samples: Sample[], key: (s: Sample) => string): Row[] {
  return [...Map.groupBy(samples, key)].flatMap(([group, rows]) => {
    const arms = [...Map.groupBy(rows, (s) => s.arm)].toSorted(
      ([, a], [, b]) => Number(b[0]?.base) - Number(a[0]?.base),
    );
    const base = passing(arms[0]?.[1] ?? []);
    const baseMedian = base.length > 0 ? median(base) : Number.NaN;
    const floor = Math.max(base.length > 1 ? 2 * standardDeviation(base) : 0, 0.1 * baseMedian);
    return arms.map(([arm, rs], i): Row => {
      const walls = passing(rs);
      const wall = walls.length > 0 ? median(walls) : Number.NaN;
      const p = i === 0 || walls.length === 0 ? undefined : pValue(base, walls);
      return {
        group,
        arm,
        n: walls.length,
        wall,
        mad: walls.length > 0 ? medianAbsoluteDeviation(walls) / wall : Number.NaN,
        floor,
        change: i === 0 ? undefined : (wall - baseMedian) / baseMedian,
        p,
        significant: p !== undefined && p < 0.1 && Math.abs(wall - baseMedian) >= floor,
        latency: mid(rs.map((s) => s.latency)),
        bytesRead: mid(rs.map((s) => s.bytesRead)),
        rowsScanned: mid(rs.map((s) => s.rowsScanned)),
        peakBuffer: mid(rs.map((s) => s.peakBuffer)),
        rss: mid(rs.map((s) => s.rss)),
        size: mid(rs.map((s) => s.size)),
        ooms: rs.filter((s) => s.oom).length,
        failures: rs.length - walls.length,
      };
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
