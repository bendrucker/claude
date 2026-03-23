SELECT te.*
FROM tool_errors te
JOIN sessions s USING (session_id)
WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND (getvariable('error_type') IS NULL OR te.error_type = getvariable('error_type'))
ORDER BY te.timestamp DESC
LIMIT getvariable('limit');
