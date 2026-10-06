-- ---
-- name: diagnostics
-- tier: 1
-- summary: >-
--   Recurring type-checker, linter, and LSP diagnostics grouped by source, severity, and
--   code, with file and session spread.
-- description: >-
--   The self-improvement signal for systematic mistakes: a code that recurs across many
--   files and sessions is a pattern worth a rule, a snippet, or a habit.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH d AS (
  SELECT dg.*
  FROM diagnostics dg
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  source,
  severity,
  code,
  COUNT(*)                                 AS occurrences,
  COUNT(DISTINCT file)                     AS files,
  COUNT(DISTINCT (host, session_id))       AS sessions,
  MAX(timestamp)                           AS last_seen
FROM d
GROUP BY source, severity, code
ORDER BY occurrences DESC, source, code;
