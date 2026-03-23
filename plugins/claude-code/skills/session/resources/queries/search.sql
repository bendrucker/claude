SELECT s.*
FROM sessions s
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.session_id = s.session_id
    AND (m.content_text ILIKE '%' || $query || '%'
      OR m.summary ILIKE '%' || $query || '%')
)
  AND date_filter(s.start_time, $after_date, $before_date)
  AND project_filter(s.project_path, $project)
ORDER BY s.start_time DESC
LIMIT $limit;
