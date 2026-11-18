-- ---
-- name: plan-delivery
-- summary: >-
--   Weekly share of planning sessions per host that received the plan plugin's injected
--   guidelines, the delivery-health signal for that injection.
-- description: >-
--   One row per (`host`, `week`), each session assigned to the week it started. A planning
--   session is a main-thread transcript that entered plan mode (a `plan` permission mode on
--   a `permission-mode` or `user` record) or called `EnterPlanMode` or `ExitPlanMode`.
--   `delivered` counts those with a `hook_additional_context` attachment holding the
--   "# Planning Guidelines" heading, the record a command hook's `additionalContext` leaves.
--   2026-10-16 through the command-hook return read as 0% on every host: the mod that
--   delivered in that window rewrote the plan-mode reminder in memory, which the transcript
--   never records. A host whose `delivered_pct` drops to zero while `planning_sessions`
--   holds steady has stopped receiving the injection.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH main_thread AS (
  SELECT host, session_id, type, data
  FROM raw
  WHERE subagent_id(source_file) IS NULL
),
planning AS (
  SELECT DISTINCT host, session_id
  FROM main_thread
  WHERE type IN ('permission-mode', 'user') AND (data->>'$.permissionMode') = 'plan'
  UNION
  SELECT DISTINCT host, session_id
  FROM content_items
  WHERE type = 'tool_use'
    AND name IN ('EnterPlanMode', 'ExitPlanMode')
    AND subagent_id(source_file) IS NULL
),
delivered AS (
  SELECT DISTINCT host, session_id
  FROM main_thread
  WHERE type = 'attachment'
    AND (data->>'$.attachment.type') = 'hook_additional_context'
    AND contains(CAST(data AS VARCHAR), '# Planning Guidelines')
)
SELECT
  s.host,
  strftime(date_trunc('week', s.start_time), '%Y-%m-%d')    AS week,
  COUNT(*)                                                  AS planning_sessions,
  COUNT(d.session_id)                                       AS delivered,
  ROUND(100.0 * COUNT(d.session_id) / COUNT(*), 1)          AS delivered_pct
FROM planning p
JOIN sessions s USING (host, session_id)
LEFT JOIN delivered d USING (host, session_id)
WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
GROUP BY s.host, date_trunc('week', s.start_time)
ORDER BY week, s.host;
