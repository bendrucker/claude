-- ---
-- name: files
-- tier: 1
-- summary: "File hotspots: the files you read and edit most, across sessions."
-- description: Reveals where work concentrates and which files churn.
-- params:
--   - limit
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH f AS (
  SELECT fo.*
  FROM file_operations fo
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  file_path,
  COUNT(*) FILTER (WHERE operation = 'Read')                                       AS reads,
  COUNT(*) FILTER (WHERE operation IN ('Edit', 'Write', 'MultiEdit', 'NotebookEdit')) AS edits,
  COUNT(DISTINCT (host, session_id))                                               AS sessions,
  MAX(timestamp)                                                                   AS last_seen
FROM f
GROUP BY file_path
ORDER BY edits DESC, reads DESC, file_path
LIMIT getvariable('limit')::BIGINT;
