CREATE OR REPLACE TABLE content_items AS
SELECT * FROM read_ndjson(
  getvariable('data_dir') || '/content_items.jsonl',
  auto_detect=true,
  union_by_name=true
);

CREATE OR REPLACE TABLE messages AS
SELECT
  e.* EXCLUDE (sessionId, cwd, gitBranch, isMeta, isSidechain, durationMs, message_content, toolUseResult, usage, timestamp, summary),
  e.sessionId::VARCHAR as session_id,
  e.timestamp::TIMESTAMP as timestamp,
  e.cwd as project_path,
  e.gitBranch as git_branch,
  COALESCE(e.isMeta, false) as is_meta,
  COALESCE(e.isSidechain, false) as is_sidechain,
  e.durationMs as duration_ms,
  e.usage.input_tokens as input_tokens,
  e.usage.output_tokens as output_tokens,
  CASE WHEN json_type(e.message_content) = 'VARCHAR' THEN e.message_content::VARCHAR END as content_text,
  s.summary
FROM raw e
LEFT JOIN (
  SELECT sessionId, summary
  FROM raw
  WHERE type = 'summary' AND summary IS NOT NULL
) s USING (sessionId)
WHERE e.type IN ('user', 'assistant');

CREATE OR REPLACE VIEW tool_calls AS
SELECT
  name as tool_name,
  id as tool_id,
  session_id::VARCHAR as session_id,
  project_path,
  timestamp::TIMESTAMP as timestamp
FROM content_items
WHERE type = 'tool_use'
  AND name IS NOT NULL;

CREATE OR REPLACE VIEW tool_errors AS
SELECT
  er.tool_use_id as tool_id,
  er.content as error_content,
  COALESCE(tc.tool_name, 'unknown') as tool_name,
  er.session_id::VARCHAR as session_id,
  tc.project_path,
  er.timestamp::TIMESTAMP as timestamp,
  CASE WHEN TRIM(er.tool_use_result::VARCHAR, '"') = 'User rejected tool use' THEN 'rejection' ELSE 'failure' END as error_type
FROM content_items er
LEFT JOIN tool_calls tc ON er.tool_use_id = tc.tool_id
WHERE er.type = 'tool_result'
  AND er.is_error;

CREATE OR REPLACE VIEW skill_calls AS
SELECT
  TRIM(input.skill::VARCHAR, '"') as skill_name,
  NULLIF(TRIM(input.args::VARCHAR, '"'), '') as args,
  id as tool_id,
  session_id::VARCHAR as session_id,
  project_path,
  timestamp::TIMESTAMP as timestamp
FROM content_items
WHERE type = 'tool_use'
  AND name = 'Skill'
  AND input.skill IS NOT NULL;

CREATE OR REPLACE VIEW permission_requests AS
SELECT
  tc.name as tool_name,
  tc.id as tool_id,
  TRIM(tc.input['command']::VARCHAR, '"') as command,
  TRIM(tc.input['file_path']::VARCHAR, '"') as file_path,
  TRIM(tc.input['description']::VARCHAR, '"') as description,
  tc.session_id::VARCHAR as session_id,
  tc.project_path,
  tc.timestamp::TIMESTAMP as timestamp
FROM content_items er
JOIN content_items tc ON er.tool_use_id = tc.id
WHERE er.type = 'tool_result'
  AND TRIM(er.tool_use_result::VARCHAR, '"') = 'User rejected tool use';

CREATE OR REPLACE VIEW sandbox_bypasses AS
SELECT
  bypass.command,
  bypass.description,
  bypass.tool_id,
  bypass.session_id,
  bypass.project_path,
  bypass.timestamp,
  prior_fail.tool_id as retried_tool_id,
  prior_fail.error as retried_error
FROM (
  SELECT
    TRIM(input['command']::VARCHAR, '"') as command,
    TRIM(input['description']::VARCHAR, '"') as description,
    id as tool_id,
    session_id::VARCHAR as session_id,
    project_path,
    timestamp::TIMESTAMP as timestamp
  FROM content_items
  WHERE type = 'tool_use'
    AND name = 'Bash'
    AND input['dangerouslyDisableSandbox']::VARCHAR = 'true'
) bypass
LEFT JOIN LATERAL (
  SELECT
    tc.id as tool_id,
    TRIM(er.content::VARCHAR, '"') as error
  FROM content_items tc
  JOIN content_items er
    ON er.tool_use_id = tc.id
    AND er.type = 'tool_result'
    AND er.is_error
  WHERE tc.type = 'tool_use'
    AND tc.name = 'Bash'
    AND COALESCE(tc.input['dangerouslyDisableSandbox']::VARCHAR, 'false') = 'false'
    AND tc.session_id::VARCHAR = bypass.session_id
    AND tc.timestamp::TIMESTAMP < bypass.timestamp
    AND TRIM(tc.input['command']::VARCHAR, '"') = bypass.command
  ORDER BY tc.timestamp::TIMESTAMP DESC
  LIMIT 1
) prior_fail ON true;

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
