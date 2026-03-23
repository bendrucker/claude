SELECT s.*
FROM sessions s
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.session_id = s.session_id
    AND (m.content_text ILIKE '%' || getvariable('query') || '%'
      OR m.summary ILIKE '%' || getvariable('query') || '%')
)
  AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
ORDER BY s.start_time DESC
LIMIT getvariable('limit');
