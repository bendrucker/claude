-- Hook activity and performance overview, one row per hook (keyed by command, or
-- hook_name when no command is recorded). Surfaces how often each hook runs, how
-- often it blocks/asks/errors, how much context it injects, and its latency.
-- Params: after_date, before_date, project, host, event (hook_event filter), hook
-- (GLOB on command/name). Pass null to skip any filter.
WITH ev AS (
  SELECT he.*
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND (getvariable('event') IS NULL OR he.hook_event = getvariable('event')::VARCHAR)
    AND (getvariable('hook') IS NULL OR COALESCE(he.command, he.hook_name) GLOB getvariable('hook')::VARCHAR)
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
  MAX(timestamp) AS last_seen
FROM ev
GROUP BY hook
ORDER BY runs DESC, hook;
