SELECT s.*
FROM sessions s
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.session_id = s.session_id
    AND (m.content_text ILIKE '%' || $query || '%'
      OR m.summary ILIKE '%' || $query || '%')
)
  AND ($after_date IS NULL OR s.start_time::TIMESTAMP >= $after_date::TIMESTAMP)
  AND ($before_date IS NULL OR s.start_time::TIMESTAMP <= $before_date::TIMESTAMP)
  AND ($project IS NULL OR s.project_path ILIKE '%' || $project || '%')
ORDER BY s.start_time DESC
LIMIT $limit;
