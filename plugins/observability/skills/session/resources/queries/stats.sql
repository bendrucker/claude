-- ---
-- name: stats
-- tier: 1
-- summary: Tool usage breakdown with error rates and aggregate totals.
-- description: >-
--   One row per tool with uses, errors, and error rate, and the window's total calls and
--   sessions repeated on every row so a share is readable without a second query.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH filtered_calls AS (
  SELECT tc.*
  FROM tool_calls tc
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
per_tool AS (
  SELECT
    fc.tool_name,
    COUNT(*) as uses,
    COUNT(te.error_content) as errors
  FROM filtered_calls fc
  LEFT JOIN tool_errors te ON fc.tool_id = te.tool_id AND fc.host = te.host
  GROUP BY fc.tool_name
)
SELECT
  tool_name,
  uses,
  errors,
  ROUND(errors::DOUBLE / uses * 100, 1) as error_rate_pct,
  (SELECT COUNT(DISTINCT (host, session_id)) FROM filtered_calls) as total_sessions,
  (SELECT SUM(uses) FROM per_tool) as total_tool_uses,
  (SELECT SUM(errors) FROM per_tool) as total_errors
FROM per_tool
ORDER BY uses DESC, tool_name;
