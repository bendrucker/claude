-- ---
-- name: hooks
-- tier: 1
-- summary: >-
--   Per-hook runs, friction rate, and latency corrected for host-wide slowdowns, one row
--   per hook keyed by command (or `hook_name` when no command is recorded).
-- description: >-
--   Runs, blocks, asks, errors, cancelled, context injections, friction rate, and p50/p95
--   duration, plus `ambient_p50_ms` (the median duration of every other hook on the same
--   host in the same hour) and `excess_p95_ms` (the tail left after subtracting it).
--   `excess_p95_ms` is the attributable figure: `p95_ms` absorbs host-wide slowdowns, so a
--   hook with a high `p95_ms`, a high `ambient_p50_ms`, and a near-zero `excess_p95_ms` was
--   slow because the machine was slow. Both are NULL when no hour had enough peers.
--
--   `blocks` and `friction_pct` count only what `hook_events` recorded, which excludes
--   every PreToolUse `permissionDecision: deny`: that path writes no hook record, so a hook
--   that mostly denies reads as frictionless here. The recovered volume lives in the
--   `hook_denies` view, which `hook-blocks` reports and `index-health` sizes. It is not
--   folded in here because a recovered deny carries no command and no duration, so it
--   cannot key to a row or contribute to the latency columns.
-- params:
--   - name: event
--     meaning: hook_event filter
--   - name: hook
--     meaning: GLOB on command/name
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH scoped AS (
  SELECT he.*
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
buckets AS (
  SELECT COALESCE(command, hook_name, '(unknown)') AS hook_key,
         host,
         date_trunc('hour', timestamp) AS hr,
         duration_ms
  FROM scoped
  WHERE duration_ms IS NOT NULL
),
-- Leave-one-out, so a single high-volume hook cannot set its own baseline. Built
-- from `scoped` (before the event and hook filters) so scoping the query to one
-- hook does not collapse the ambient population onto that hook. Buckets with
-- fewer than 3 peer runs are too thin to call ambient and yield no baseline.
ambient AS (
  SELECT a.hook_key, a.host, a.hr,
         quantile_cont(b.duration_ms, 0.5) AS baseline_ms
  FROM (SELECT DISTINCT hook_key, host, hr FROM buckets) a
  JOIN buckets b
    ON a.host = b.host AND a.hr = b.hr AND a.hook_key <> b.hook_key
  GROUP BY 1, 2, 3
  HAVING COUNT(*) >= 3
),
ev AS (
  SELECT sc.*, am.baseline_ms
  FROM scoped sc
  LEFT JOIN ambient am
    ON am.hook_key = COALESCE(sc.command, sc.hook_name, '(unknown)')
   AND am.host = sc.host
   AND am.hr = date_trunc('hour', sc.timestamp)
  WHERE (getvariable('event') IS NULL OR sc.hook_event = getvariable('event')::VARCHAR)
    AND (getvariable('hook') IS NULL OR COALESCE(sc.command, sc.hook_name) GLOB getvariable('hook')::VARCHAR)
)
SELECT
  COALESCE(command, hook_name, '(unknown)') AS hook,
  string_agg(DISTINCT hook_event, ',')      AS events,
  COUNT(*)                                   AS runs,
  COUNT(*) FILTER (WHERE blocked)            AS blocks,
  COUNT(*) FILTER (WHERE decision = 'ask')   AS asks,
  COUNT(*) FILTER (WHERE kind = 'hook_non_blocking_error') AS errors,
  COUNT(*) FILTER (WHERE kind = 'hook_cancelled')          AS cancelled,
  COUNT(*) FILTER (WHERE additional_context IS NOT NULL OR kind = 'hook_additional_context') AS context_adds,
  ROUND(100.0 * COUNT(*) FILTER (WHERE blocked OR decision = 'ask') / COUNT(*), 1) AS friction_pct,
  CAST(quantile_cont(duration_ms, 0.5)  AS BIGINT) AS p50_ms,
  CAST(quantile_cont(duration_ms, 0.95) AS BIGINT) AS p95_ms,
  CAST(quantile_cont(baseline_ms, 0.5)  AS BIGINT) AS ambient_p50_ms,
  -- GREATEST skips NULL arguments rather than propagating them, so guard both
  -- NULL inputs explicitly. Without the CASE, an untimed run or a hook with no
  -- baseline would contribute a fabricated zero to the quantile.
  CAST(quantile_cont(
    CASE
      WHEN baseline_ms IS NULL OR duration_ms IS NULL THEN NULL
      ELSE GREATEST(duration_ms - baseline_ms, 0)
    END, 0.95) AS BIGINT) AS excess_p95_ms,
  MAX(timestamp) AS last_seen
FROM ev
GROUP BY hook
ORDER BY runs DESC, hook;
