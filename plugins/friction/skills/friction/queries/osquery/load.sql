-- Loads the snapshot logs and keeps the window, in the session time zone (the machine's by default), ending on `day` (default today) and spanning `days` (default 1).
-- `osquery_dir` is the log directory.
-- CPU and bytes are cumulative per process, so deltas are taken before the window filter.
CREATE MACRO win_start() AS epoch((coalesce(getvariable('day'), current_date)::DATE - (coalesce(getvariable('days'), 1) - 1))::TIMESTAMPTZ);
CREATE MACRO win_end() AS epoch((coalesce(getvariable('day'), current_date)::DATE + 1)::TIMESTAMPTZ);

CREATE TABLE snaps AS
SELECT name, unixTime::BIGINT AS t, unnest(snapshot) AS j
FROM read_json(getvariable('osquery_dir') || '/osqueryd.snapshots.log*',
  format = 'newline_delimited', columns = {name: 'VARCHAR', unixTime: 'BIGINT', snapshot: 'JSON[]'})
WHERE unixTime < win_end() AND unixTime >= win_start() - 600;

CREATE TABLE pressure AS
SELECT DISTINCT t, (j->>'pressure_level')::INT AS lvl, (j->>'available_pct')::INT AS avail,
  (j->>'swap_used_mb')::DOUBLE AS swap, (j->>'load1')::DOUBLE AS load1
FROM snaps WHERE name = 'pressure' AND t >= win_start();

CREATE TABLE cpu AS
WITH p AS (
  SELECT DISTINCT t, (j->>'pid')::INT AS pid, j->>'name' AS pname, j->>'cwd' AS cwd,
    (j->>'start_time')::BIGINT AS st, (j->>'footprint')::BIGINT AS fp,
    (j->>'user_time')::BIGINT + (j->>'system_time')::BIGINT AS cpu_ms,
    (j->>'disk_bytes_written')::BIGINT AS dw
  FROM snaps WHERE name = 'procs')
SELECT * FROM (
  SELECT *, cpu_ms - lag(cpu_ms) OVER w AS dcpu, dw - lag(dw) OVER w AS ddw
  FROM p WINDOW w AS (PARTITION BY pid, st ORDER BY t))
WHERE t >= win_start();

CREATE TABLE groups AS
WITH g AS (
  SELECT DISTINCT t, j->>'name' AS pname, (j->>'processes')::INT AS n,
    (j->>'threads')::INT AS thr, (j->>'cpu_time')::BIGINT AS cpu_ms,
    (j->>'disk_bytes_written')::BIGINT AS dw
  FROM snaps WHERE name = 'proc_groups')
-- A group's totals drop when a member exits, so a negative delta is unknown, not zero.
SELECT * REPLACE (CASE WHEN dcpu >= 0 THEN dcpu END AS dcpu, CASE WHEN ddw >= 0 THEN ddw END AS ddw) FROM (
  SELECT *, cpu_ms - lag(cpu_ms) OVER w AS dcpu, dw - lag(dw) OVER w AS ddw
  FROM g WINDOW w AS (PARTITION BY pname ORDER BY t))
WHERE t >= win_start();

-- Share of CPU ticks idle since the previous sample, across all cores.
CREATE TABLE host AS
SELECT t, idle_pct FROM (
  SELECT t, 100 * (idle - lag(idle) OVER w) / nullif(total - lag(total) OVER w, 0) AS idle_pct
  FROM (
    SELECT DISTINCT t, (j->>'idle')::BIGINT AS idle,
      (j->>'user')::BIGINT + (j->>'nice')::BIGINT + (j->>'system')::BIGINT + (j->>'idle')::BIGINT AS total
    FROM snaps WHERE name = 'host_cpu')
  WINDOW w AS (ORDER BY t))
WHERE t >= win_start();
