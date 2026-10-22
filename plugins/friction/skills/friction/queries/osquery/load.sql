-- Loads the snapshot logs and keeps the window ending on `day` (default today) and spanning `days` (default 1).
-- `osquery_dir` is the log directory.
-- CPU and bytes are cumulative per process, so deltas are taken before the window filter.
SET TimeZone = 'America/Los_Angeles';
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
    (j->>'threads')::INT AS thr, (j->>'cpu_time')::BIGINT AS cpu_ms
  FROM snaps WHERE name = 'proc_groups')
SELECT * FROM (SELECT *, cpu_ms - lag(cpu_ms) OVER (PARTITION BY pname ORDER BY t) AS dcpu FROM g)
WHERE t >= win_start();
