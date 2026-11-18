-- ---
-- name: classifier
-- summary: >-
--   Auto-mode classifier volume and latency, the permission stall on every dispatched call,
--   and the allow rules auto mode dropped.
-- description: >-
--   One row per (`section`, `week`, `dim1`, `dim2`).
--
--   `classifier-request` reads the debug log's `classifier_request_finished` lines. `dim1` is
--   the stage, `dim2` is the outcome, and the latencies come from `durationMs`.
--   `permission-decision` reads `permissionDecisionMs` from `tool_dispatch_start`, the wait
--   between a call and its dispatch on allowed and classified calls alike. `dim1` is the tool.
--   `dropped-allow-rule` lists each allow rule auto mode ignored because it bypasses the
--   classifier. `dim1` is the rule, `dim2` is the settings file, and `calls` counts the
--   sessions that loaded it.
--
--   Every section exists only for sessions run with debug logging on. The debug log is this
--   machine's, so every row is `local`.
-- params:
--   - after_date
--   - before_date
--   - host
-- ---
WITH debug AS (
  SELECT *
  FROM debug_events
  WHERE date_filter(ts, getvariable('after_date'), getvariable('before_date'))
    AND host_filter(host, getvariable('host'))
),
timed AS (
  SELECT
    'classifier-request' AS section,
    ts,
    fields->>'stage' AS dim1,
    fields->>'outcome' AS dim2,
    TRY_CAST(fields->>'durationMs' AS DOUBLE) AS ms
  FROM debug
  WHERE event = 'classifier_request_finished'
  UNION ALL
  SELECT
    'permission-decision',
    ts,
    fields->>'tool',
    NULL,
    TRY_CAST(fields->>'permissionDecisionMs' AS DOUBLE)
  FROM debug
  WHERE event = 'tool_dispatch_start'
)
SELECT
  section,
  date_trunc('week', ts)::DATE AS week,
  dim1,
  dim2,
  COUNT(*) AS calls,
  ROUND(quantile_cont(ms, 0.5)) AS p50_ms,
  ROUND(quantile_cont(ms, 0.9)) AS p90_ms,
  ROUND(quantile_cont(ms, 0.99)) AS p99_ms,
  MAX(ms) AS max_ms
FROM timed
GROUP BY ALL
UNION ALL
SELECT
  'dropped-allow-rule',
  date_trunc('week', ts)::DATE,
  fields->>'rule',
  fields->>'source',
  COUNT(DISTINCT session_id),
  NULL,
  NULL,
  NULL,
  NULL
FROM debug
WHERE event = 'dangerous_rule_ignored'
GROUP BY ALL
ORDER BY section, week, calls DESC, dim1, dim2;
