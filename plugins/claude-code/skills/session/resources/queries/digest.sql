SELECT *
FROM sessions
WHERE ($after_date IS NULL OR start_time >= $after_date::TIMESTAMP)
  AND ($before_date IS NULL OR start_time <= $before_date::TIMESTAMP)
  AND ($project IS NULL OR project_path ILIKE '%' || $project || '%')
  AND ($session_id IS NULL OR session_id = $session_id)
ORDER BY start_time DESC
LIMIT $limit;
