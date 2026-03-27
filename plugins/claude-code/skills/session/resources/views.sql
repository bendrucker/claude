CREATE OR REPLACE TEMP VIEW normalized AS
WITH base AS (
  SELECT
    e.* EXCLUDE (summary),
    s.summary
  FROM raw e
  LEFT JOIN (
    SELECT sessionId, summary
    FROM raw
    WHERE type = 'summary' AND summary IS NOT NULL
  ) s USING (sessionId)
  WHERE e.type IN ('user', 'assistant')
    AND e.message_content IS NOT NULL
),
string_content AS (
  SELECT
    *,
    message_content::VARCHAR as content_text,
    NULL::VARCHAR as item_type,
    NULL::VARCHAR as tool_name,
    NULL::VARCHAR as tool_id,
    NULL::VARCHAR as tool_use_id,
    NULL::VARCHAR as result_content,
    false as is_error,
    false as is_rejection
  FROM base
  WHERE json_type(message_content) = 'VARCHAR'
),
array_content AS (
  SELECT
    b.*,
    CASE WHEN item.type = 'text' THEN item.text END as content_text,
    item.type as item_type,
    item.name as tool_name,
    item.id as tool_id,
    item.tool_use_id,
    item.content as result_content,
    COALESCE(item.is_error, false) as is_error,
    COALESCE(b.toolUseResult::VARCHAR = 'User rejected tool use', false) as is_rejection
  FROM base b,
  LATERAL (
    SELECT unnest(from_json(b.message_content, '[{
      "type": "VARCHAR",
      "text": "VARCHAR",
      "name": "VARCHAR",
      "id": "VARCHAR",
      "tool_use_id": "VARCHAR",
      "content": "VARCHAR",
      "is_error": "BOOLEAN"
    }]')) as item
  ) t
  WHERE json_type(b.message_content) = 'ARRAY'
    AND json_array_length(b.message_content) > 0
),
all_content AS (
  SELECT * FROM string_content
  UNION ALL BY NAME
  SELECT * FROM array_content
)
SELECT
  * EXCLUDE (sessionId, cwd, gitBranch, isMeta, isSidechain, durationMs, message_content, toolUseResult, usage, timestamp),
  sessionId::VARCHAR as session_id,
  timestamp::TIMESTAMP as timestamp,
  cwd as project_path,
  gitBranch as git_branch,
  COALESCE(isMeta, false) as is_meta,
  COALESCE(isSidechain, false) as is_sidechain,
  durationMs as duration_ms,
  usage.input_tokens as input_tokens,
  usage.output_tokens as output_tokens
FROM all_content;

CREATE OR REPLACE TABLE messages AS
SELECT * FROM normalized;

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
