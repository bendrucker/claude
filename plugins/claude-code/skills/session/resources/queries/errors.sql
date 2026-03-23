SELECT te.*
FROM tool_errors te
JOIN sessions s USING (session_id)
WHERE date_filter(s.start_time, $after_date, $before_date)
  AND project_filter(s.project_path, $project)
  AND ($error_type IS NULL OR te.error_type = $error_type)
ORDER BY te.timestamp DESC
LIMIT $limit;
