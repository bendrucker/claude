import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

// Each case writes synthetic telemetry, runs a source's load.sql and one named
// query exactly as collect.sh does, and compares the rows.

const DAY = "2026-10-20";
// 10:00 on DAY, and the same time the day before. Cases pin the session to UTC.
const T0 = Date.parse("2026-10-20T10:00:00Z") / 1000;
const YESTERDAY = T0 - 86_400;

interface Snapshot {
  name: string;
  t: number;
  rows: Record<string, number | string>[];
}

const pressure = (t: number, load1: number, lvl = 1): Snapshot => ({
  name: "pressure",
  t,
  rows: [{ pressure_level: lvl, available_pct: 50, swap_used_mb: 0, load1 }],
});

const proc = (t: number, pid: number, name: string, cpuMs: number, written: number): Snapshot => ({
  name: "procs",
  t,
  rows: [
    {
      pid,
      name,
      cwd: "/tmp",
      start_time: 1,
      footprint: 2 ** 30,
      user_time: cpuMs,
      system_time: 0,
      disk_bytes_written: written,
    },
  ],
});

// Cumulative CPU ticks summed over cores. Each sample adds 100 ticks, `idle` of them idle.
const hostCpu = (idle: number) => {
  let total = 0;
  let idleTicks = 0;
  return (t: number): Snapshot => {
    total += 100;
    idleTicks += idle;
    return {
      name: "host_cpu",
      t,
      rows: [{ user: total - idleTicks, nice: 0, system: 0, idle: idleTicks }],
    };
  };
};

const group = (
  t: number,
  name: string,
  threads: number,
  cpuMs: number,
  written: number,
): Snapshot => ({
  name: "proc_groups",
  t,
  rows: [
    {
      name,
      processes: 5,
      threads,
      cpu_time: cpuMs,
      disk_bytes_read: 0,
      disk_bytes_written: written,
    },
  ],
});

// One sample every 10 s for `minutes`, starting at `t`.
const every10s = (t: number, minutes: number, make: (t: number) => Snapshot) =>
  Array.from({ length: minutes * 6 }, (_, i) => make(t + i * 10));

async function osquery(snapshots: Snapshot[], query: string, days = 1) {
  const dir = mkdtempSync(join(tmpdir(), "friction-osquery-"));
  const lines = snapshots.map((s) =>
    JSON.stringify({ name: s.name, unixTime: s.t, snapshot: s.rows }),
  );
  await Bun.write(join(dir, "osqueryd.snapshots.log"), `${lines.join("\n")}\n`);
  return run("osquery", query, {
    osquery_dir: `'${dir}'`,
    day: `DATE '${DAY}'`,
    days: `${days}`,
  });
}

let conn: DuckDBConnection;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(":memory:")).connect();
});
afterAll(() => {
  conn.closeSync();
});

async function run(source: string, query: string, vars: Record<string, string>) {
  // Cases share one in-memory instance, so drop what the last case loaded.
  const tables = ["snaps", "pressure", "cpu", "groups", "host", "runs"];
  await conn.run(
    [
      "DROP MACRO IF EXISTS win_start",
      "DROP MACRO IF EXISTS win_end",
      ...tables.map((t) => `DROP TABLE IF EXISTS ${t}`),
    ].join(";\n"),
  );
  const sets = [
    "SET TimeZone = 'UTC';",
    ...Object.entries(vars).map(([k, v]) => `SET VARIABLE ${k} = ${v};`),
  ];
  const dir = join(import.meta.dirname, source);
  await conn.run(sets.join("\n") + (await Bun.file(join(dir, "load.sql")).text()));
  const reader = await conn.runAndReadAll(await Bun.file(join(dir, `${query}.sql`)).text());
  return reader.getRowObjectsJson();
}

describe("osquery", () => {
  test("saturation counts minutes with no idle sample over 5%, in the window only", async () => {
    const busy = hostCpu(2);
    const rows = await osquery(
      [
        ...every10s(YESTERDAY, 30, busy),
        ...every10s(T0, 10, busy),
        ...every10s(T0 + 600, 20, hostCpu(50)),
      ],
      "saturation",
    );
    // The first sample has no delta, so minute 0 is saturated from five samples.
    expect(rows).toEqual([{ day: DAY, saturated_mins: "10", min_idle_pct: 2 }]);
  });

  test("saturation spans every day in a multi-day window", async () => {
    const rows = await osquery(
      [...every10s(YESTERDAY, 2, hostCpu(1)), ...every10s(T0, 2, hostCpu(40))],
      "saturation",
      2,
    );
    expect(rows.map((r) => [r.day, r.saturated_mins])).toEqual([
      ["2026-10-19", "2"],
      [DAY, "0"],
    ]);
  });

  test("attribution counts saturated minutes within 2 minutes of a job", async () => {
    const rows = await osquery(
      [
        ...every10s(T0, 5, hostCpu(1)),
        ...every10s(T0 + 3600, 5, hostCpu(60)),
        proc(T0 + 60, 100, "bun", 1000, 0),
      ],
      "attribution",
    );
    expect(rows).toEqual([
      { day: DAY, saturated: false, mins: "5", pct_with_job: 0 },
      // The job's one sample in minute 1 covers minutes 0 to 3, not 4.
      { day: DAY, saturated: true, mins: "5", pct_with_job: 80 },
    ]);
  });

  test("thread hogs name groups using CPU while it is saturated", async () => {
    const rows = await osquery(
      [
        ...every10s(T0, 2, hostCpu(1)),
        ...every10s(T0, 2, (t) => group(t, "duckdb", 400, (t - T0) * 1000, 0)),
      ],
      "thread-hogs",
    );
    expect(rows).toEqual([{ day: DAY, pname: "duckdb", avg_threads: 400, cpu_minutes: 1.8 }]);
  });

  test("thread hogs are empty before proc_groups exists", async () => {
    expect(await osquery(every10s(T0, 1, hostCpu(1)), "thread-hogs")).toEqual([]);
  });

  test("write rate flags names over 1 GiB in a minute, skipping exits", async () => {
    const GiB = 2 ** 30;
    const rows = await osquery(
      [
        group(T0, "bun", 10, 0, 0),
        group(T0 + 30, "bun", 10, 0, 2 * GiB),
        // A member exited, so the group total fell.
        group(T0 + 70, "bun", 10, 0, GiB),
        group(T0 + 130, "bun", 10, 0, GiB + GiB / 2),
      ],
      "write-rate",
    );
    expect(rows).toEqual([{ day: DAY, pname: "bun", heavy_mins: "1", peak_gb_per_min: 2 }]);
  });

  test("heavy writers count only bytes written inside the window", async () => {
    const GiB = 2 ** 30;
    const rows = await osquery(
      [
        proc(T0 - 86_400 + 3600, 7, "bun", 0, 0),
        proc(T0 - 300, 7, "bun", 0, 5 * GiB),
        proc(T0, 7, "bun", 0, 6 * GiB),
        proc(T0 + 60, 7, "bun", 0, 8 * GiB),
      ],
      "heavy-writers",
    );
    expect(rows).toEqual([{ day: DAY, pname: "bun", cwd: "/tmp", fp_gb: 1, written_gb: 3 }]);
  });

  test("memory reports seconds at level 2 or above", async () => {
    const rows = await osquery(
      [...every10s(T0, 1, (t) => pressure(t, 1, 2)), pressure(T0 + 600, 1, 1)],
      "memory",
    );
    expect(rows).toEqual([{ day: DAY, warn_s: "60", max_swap_mb: 0, min_avail_pct: 50 }]);
  });
});

describe("atuin", () => {
  const ns = (s: number) => BigInt(Math.round(s * 1e9));

  async function atuin(
    runs: [command: string, exit: number, seconds: number, at?: number][],
    query: string,
  ) {
    const path = join(mkdtempSync(join(tmpdir(), "friction-atuin-")), "history.db");
    const db = new Database(path);
    db.run(
      "CREATE TABLE history (id TEXT, timestamp INTEGER, duration INTEGER, exit INTEGER, command TEXT, deleted_at INTEGER)",
    );
    const insert = db.prepare("INSERT INTO history VALUES (?, ?, ?, ?, ?, NULL)");
    for (const [i, [command, exit, seconds, at = T0]] of runs.entries()) {
      insert.run(String(i), ns(at + i), ns(seconds), exit, command);
    }
    db.close();
    return run("atuin", query, {
      atuin_db: `'${path}'`,
      day: `DATE '${DAY}'`,
      days: "1",
    });
  }

  test("failing flags heads that fail a third of 5+ runs, by command head", async () => {
    const rows = await atuin(
      [
        ["g pull origin main", 1, 1],
        ["g pull origin main", 1, 1],
        ["g pull --rebase", 0, 1],
        ["g pull", 0, 1],
        ["g pull", 0, 1],
        ["ls -la", 0, 0],
        ["imported", -1, 0],
      ],
      "failing",
    );
    expect(rows).toEqual([{ day: DAY, head: "g pull", runs: "5", fail_rate: 0.4 }]);
  });

  test("failing ignores runs outside the window", async () => {
    const rows = await atuin(
      Array.from(
        { length: 6 },
        () => ["cloudsmith auth", 1, 1, YESTERDAY] as [string, number, number, number],
      ),
      "failing",
    );
    expect(rows).toEqual([]);
  });

  test("slow flags heads whose median run is over 30 s", async () => {
    const rows = await atuin(
      [
        ["dotfiles install", 0, 100],
        ["dotfiles install", 0, 120],
        ["git status", 0, 1],
      ],
      "slow",
    );
    expect(rows).toEqual([
      {
        day: DAY,
        head: "dotfiles install",
        runs: "2",
        median_s: 110,
        total_min: 4,
      },
    ]);
  });
});
