SELECT *
FROM sessions
WHERE date_filter(start_time, $after_date, $before_date)
  AND project_filter(project_path, $project)
  AND ($session_id IS NULL OR session_id = $session_id)
ORDER BY start_time DESC
LIMIT $limit;
