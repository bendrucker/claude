SELECT te.*
FROM tool_errors te
JOIN sessions s USING (session_id)
WHERE ($after_date IS NULL OR s.start_time >= $after_date::TIMESTAMP)
  AND ($before_date IS NULL OR s.start_time <= $before_date::TIMESTAMP)
  AND ($project IS NULL OR s.project_path ILIKE '%' || $project || '%')
  AND ($error_type IS NULL OR te.error_type = $error_type)
ORDER BY te.timestamp DESC
LIMIT $limit;
