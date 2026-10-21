# osquery Source

osqueryd runs as a user agent on each Mac, configured by the dotfiles `osquery` topic. Its snapshot log is the daily run's main source for contention.

## Data

- Snapshots: `~/.local/state/osquery/osqueryd.snapshots.log*`. Rotated files are zstd, and DuckDB's `read_json` glob reads them with the live file.
- Differential results: `~/.local/state/osquery/osqueryd.results.log*`, which holds `proc_tags` (`CLAUDE_CODE_SESSION_ID`, `HERDR_PANE_ID` per pid).

| Query | Interval | What it records |
| --- | --- | --- |
| `pressure` | 10 s | Memory pressure level, available %, swap, `load1`, VM counters |
| `procs` | 60 s | Processes above 64 MB footprint, 60 s CPU, or 256 MB written: cumulative CPU ms, bytes written, threads |
| `proc_groups` | 10 s | Per-name process count, thread total, cumulative CPU, for names with more than 3 processes or 50 threads |
| `proc_tags` | 30 s | Session and pane tags for this user's processes |

Times are epoch seconds. Run `SET TimeZone = 'America/Los_Angeles'` before bucketing by day. CPU and bytes are cumulative per process, so compute deltas over `(pid, start_time)`, never raw sums.

## Load

```sql
SET TimeZone = 'America/Los_Angeles';
CREATE TABLE snaps AS
SELECT name, unixTime::BIGINT AS t, unnest(snapshot) AS j
FROM read_json(getenv('HOME') || '/.local/state/osquery/osqueryd.snapshots.log*',
  format = 'newline_delimited', columns = {name: 'VARCHAR', unixTime: 'BIGINT', snapshot: 'JSON[]'});

CREATE TABLE pressure AS
SELECT DISTINCT t, (j->>'pressure_level')::INT AS lvl, (j->>'available_pct')::INT AS avail,
  (j->>'swap_used_mb')::DOUBLE AS swap, (j->>'load1')::DOUBLE AS load1
FROM snaps WHERE name = 'pressure';

CREATE TABLE cpu AS
WITH p AS (
  SELECT DISTINCT t, (j->>'pid')::INT AS pid, j->>'name' AS pname, j->>'cwd' AS cwd,
    (j->>'start_time')::BIGINT AS st, (j->>'footprint')::BIGINT AS fp,
    (j->>'user_time')::BIGINT + (j->>'system_time')::BIGINT AS cpu_ms,
    (j->>'disk_bytes_written')::BIGINT AS dw
  FROM snaps WHERE name = 'procs')
SELECT *, cpu_ms - lag(cpu_ms) OVER w AS dcpu, dw - lag(dw) OVER w AS ddw
FROM p WINDOW w AS (PARTITION BY pid, st ORDER BY t);

CREATE TABLE groups AS
WITH g AS (
  SELECT DISTINCT t, j->>'name' AS pname, (j->>'processes')::INT AS n,
    (j->>'threads')::INT AS thr, (j->>'cpu_time')::BIGINT AS cpu_ms
  FROM snaps WHERE name = 'proc_groups')
SELECT *, cpu_ms - lag(cpu_ms) OVER (PARTITION BY pname ORDER BY t) AS dcpu FROM g;
```

`groups` is empty on a machine whose config predates `proc_groups`. Report overload there as unattributed rather than guessing a cause.

## Named Queries

Each returns one row per day, so the run reads days seen directly. The 10 cores in the thresholds are the Studio's. Read the core count from `sysctl -n hw.ncpu` on any other machine.

### Overload minutes

```sql
SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day,
  count(*) FILTER (WHERE load1 > 20) / 6 AS mins_gt2x, count(*) FILTER (WHERE load1 > 30) / 6 AS mins_gt3x,
  round(max(load1)) AS peak
FROM pressure GROUP BY 1 ORDER BY 1;
```

### Attribution

Share of overload minutes with a named process active within 2 minutes, against quiet minutes. Swap the `IN` list to test another suspect.

```sql
WITH pm AS (SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, t // 60 AS m, max(load1) AS l FROM pressure GROUP BY 1, 2),
jm AS (SELECT DISTINCT t // 60 AS m FROM cpu WHERE pname IN ('bun', 'duckdb'))
SELECT day, l > 30 AS overloaded, count(*) AS mins,
  round(100 * avg(EXISTS (SELECT 1 FROM jm WHERE jm.m BETWEEN pm.m - 2 AND pm.m + 2)::INT)) AS pct_with_job
FROM pm GROUP BY 1, 2 ORDER BY 1, 2;
```

### Thread hogs

Which names held the runnable threads during overload. macOS load counts runnable threads, so a load of 200 is about 200 waiting threads.

```sql
SELECT strftime(to_timestamp(g.t), '%Y-%m-%d') AS day, pname, round(avg(thr)) AS avg_threads,
  round(sum(dcpu) / 1000 / 60, 1) AS cpu_minutes
FROM groups g JOIN pressure p ON p.t BETWEEN g.t - 5 AND g.t + 5
WHERE p.load1 > 30 GROUP BY 1, 2 ORDER BY 1, cpu_minutes DESC;
```

### Heavy writers

```sql
SELECT strftime(to_timestamp(st), '%Y-%m-%d') AS day, pname, any_value(cwd) AS cwd,
  round(max(fp) / 2^30, 1) AS fp_gb, round(sum(ddw) / 2^30, 1) AS written_gb
FROM cpu GROUP BY pname, pid, st HAVING sum(ddw) > 2^30 ORDER BY written_gb DESC;
```

### Memory

Quiet baseline. Record a finding only for a level-2 run longer than a minute.

```sql
SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, count(*) FILTER (WHERE lvl >= 2) * 10 AS warn_s,
  max(swap) AS max_swap_mb, min(avail) AS min_avail_pct
FROM pressure GROUP BY 1 ORDER BY 1;
```

### Steady background CPU

Processes averaging over 0.03 cores across more than 20 hours. Record these at `low` impact. They surface only if the number grows.

```sql
SELECT pname, round(sum(dcpu) / 1000 / (max(t) - min(t)), 3) AS avg_cores
FROM cpu GROUP BY pname, pid, st
HAVING max(t) - min(t) > 72000 AND sum(dcpu) / 1000 / (max(t) - min(t)) > 0.03
ORDER BY avg_cores DESC;
```

## Session Attribution

Join `proc_tags` from the results log on `(pid, start_time)` to tie a process to a Claude session or herdr pane. Only about a third of `bun`/`duckdb` pids carry a tag, so treat an untagged process as unknown, not as unrelated to Claude.
