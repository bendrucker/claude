CREATE OR REPLACE VIEW sessions AS
SELECT
  session_id,
  ANY_VALUE(summary) as summary,
  MIN(timestamp) as start_time,
  MAX(timestamp) as end_time,
  ROUND(
    EXTRACT(EPOCH FROM (MAX(timestamp::TIMESTAMP) - MIN(timestamp::TIMESTAMP))) / 60
  ) as duration_minutes,
  ANY_VALUE(project_path) as project_path,
  ANY_VALUE(git_branch) as git_branch,
  COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) as user_messages,
  COUNT(*) FILTER (WHERE type = 'assistant') as assistant_messages
FROM messages
GROUP BY session_id
HAVING COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) > 0;
