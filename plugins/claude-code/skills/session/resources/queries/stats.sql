WITH filtered_calls AS (
  SELECT tc.*
  FROM tool_calls tc
  JOIN sessions s USING (session_id)
  WHERE ($after_date IS NULL OR s.start_time >= $after_date::TIMESTAMP)
    AND ($before_date IS NULL OR s.start_time <= $before_date::TIMESTAMP)
    AND ($project IS NULL OR s.project_path ILIKE '%' || $project || '%')
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
