SELECT s.*
FROM sessions s
WHERE (
  s.label ILIKE '%' || getvariable('query') || '%'
  OR EXISTS (
    SELECT 1 FROM messages m
    WHERE m.host = s.host AND m.session_id = s.session_id
      AND m.content_text ILIKE '%' || getvariable('query') || '%'
  )
  OR EXISTS (
    SELECT 1 FROM content_items ci
    WHERE ci.host = s.host AND ci.session_id = s.session_id
      AND ci.text ILIKE '%' || getvariable('query') || '%'
  )
)
  AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
ORDER BY s.start_time DESC
LIMIT getvariable('limit');
