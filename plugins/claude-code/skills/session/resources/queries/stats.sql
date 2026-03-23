WITH filtered_calls AS (
  SELECT tc.*
  FROM tool_calls tc
  JOIN sessions s USING (session_id)
  WHERE date_filter(s.start_time, $after_date, $before_date)
    AND project_filter(s.project_path, $project)
),
per_tool AS (
  SELECT
    fc.tool_name,
    COUNT(*) as uses,
    COUNT(te.error_content) as errors
  FROM filtered_calls fc
  LEFT JOIN tool_errors te ON fc.tool_id = te.tool_id
  GROUP BY fc.tool_name
)
SELECT
  tool_name,
  uses,
  errors,
  ROUND(errors::DOUBLE / uses * 100, 1) as error_rate_pct,
  (SELECT COUNT(DISTINCT session_id) FROM filtered_calls) as total_sessions,
  (SELECT SUM(uses) FROM per_tool) as total_tool_uses,
  (SELECT SUM(errors) FROM per_tool) as total_errors
FROM per_tool
ORDER BY uses DESC;
