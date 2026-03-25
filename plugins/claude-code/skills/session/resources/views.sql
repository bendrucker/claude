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
    AND e.content IS NOT NULL
),
string_content AS (
  SELECT
    *,
    content::VARCHAR as content_text,
    NULL as item_type,
    NULL as tool_name,
    NULL as tool_id,
    NULL as tool_use_id,
    NULL as result_content,
    false as is_error,
    false as is_rejection
  FROM base
  WHERE json_type(content) = 'VARCHAR'
),
array_content AS (
  SELECT
    b.*,
    CASE
      WHEN json_extract_string(b.content, '$[' || s.idx || '].type') = 'text'
      THEN json_extract_string(b.content, '$[' || s.idx || '].text')
    END as content_text,
    json_extract_string(b.content, '$[' || s.idx || '].type') as item_type,
    json_extract_string(b.content, '$[' || s.idx || '].name') as tool_name,
    json_extract_string(b.content, '$[' || s.idx || '].id') as tool_id,
    json_extract_string(b.content, '$[' || s.idx || '].tool_use_id') as tool_use_id,
    json_extract_string(b.content, '$[' || s.idx || '].content') as result_content,
    COALESCE(
      json_extract(b.content, '$[' || s.idx || '].is_error')::BOOLEAN,
      false
    ) as is_error,
    COALESCE(b.toolUseResult = 'User rejected tool use', false) as is_rejection
  FROM base b,
  LATERAL (
    SELECT unnest(generate_series(
      0::BIGINT,
      CAST(json_array_length(b.content) AS BIGINT) - 1
    )) as idx
  ) s
  WHERE json_type(b.content) = 'ARRAY'
    AND json_array_length(b.content) > 0
)
SELECT
  sessionId as session_id,
  type,
  timestamp::TIMESTAMP as timestamp,
  cwd as project_path,
  gitBranch as git_branch,
  COALESCE(isMeta, false) as is_meta,
  content_text,
  item_type,
  tool_name,
  tool_id,
  tool_use_id,
  result_content,
  is_error,
  is_rejection,
  summary,
  model,
  usage.input_tokens as input_tokens,
  usage.output_tokens as output_tokens,
  stop_reason,
  durationMs as duration_ms,
  version,
  COALESCE(isSidechain, false) as is_sidechain,
  source_file,
  source_line
FROM string_content
UNION ALL
SELECT
  sessionId as session_id,
  type,
  timestamp::TIMESTAMP as timestamp,
  cwd as project_path,
  gitBranch as git_branch,
  COALESCE(isMeta, false) as is_meta,
  content_text,
  item_type,
  tool_name,
  tool_id,
  tool_use_id,
  result_content,
  is_error,
  is_rejection,
  summary,
  model,
  usage.input_tokens as input_tokens,
  usage.output_tokens as output_tokens,
  stop_reason,
  durationMs as duration_ms,
  version,
  COALESCE(isSidechain, false) as is_sidechain,
  source_file,
  source_line
FROM array_content;

CREATE TABLE IF NOT EXISTS messages AS
SELECT * FROM normalized WHERE false;

DELETE FROM messages
WHERE session_id IN (
  SELECT unnest(getvariable('changed_sessions'))
);

INSERT INTO messages
SELECT * FROM normalized
WHERE session_id IN (
  SELECT unnest(getvariable('changed_sessions'))
);

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
