CREATE OR REPLACE VIEW tool_calls AS
SELECT
  tool_name,
  tool_id,
  session_id,
  project_path,
  timestamp
FROM messages
WHERE item_type = 'tool_use'
  AND tool_name IS NOT NULL;

CREATE OR REPLACE VIEW tool_errors AS
SELECT
  er.tool_use_id as tool_id,
  er.result_content as error_content,
  COALESCE(tc.tool_name, 'unknown') as tool_name,
  er.session_id,
  tc.project_path,
  er.timestamp,
  CASE WHEN er.is_rejection THEN 'rejection' ELSE 'failure' END as error_type
FROM messages er
LEFT JOIN tool_calls tc ON er.tool_use_id = tc.tool_id
WHERE er.item_type = 'tool_result'
  AND er.is_error;

CREATE OR REPLACE VIEW sessions AS
SELECT
  session_id,
  ANY_VALUE(summary) as summary,
  MIN(timestamp) as start_time,
  MAX(timestamp) as end_time,
  MAX(timestamp) - MIN(timestamp) as duration,
  ANY_VALUE(project_path) as project_path,
  ANY_VALUE(git_branch) as git_branch,
  COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) as user_messages,
  COUNT(*) FILTER (WHERE type = 'assistant') as assistant_messages
FROM messages
GROUP BY session_id
HAVING COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) > 0;
