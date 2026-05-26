CREATE OR REPLACE VIEW messages AS
SELECT
  r.* EXCLUDE (data, summary),
  r.data,
  CASE
    WHEN json_type(r.data->'$.message.content') = 'VARCHAR'
    THEN r.data->>'$.message.content'
  END AS content_text,
  s.summary
FROM raw r
LEFT JOIN (
  SELECT session_id, ANY_VALUE(summary) AS summary
  FROM raw
  WHERE type = 'summary' AND summary IS NOT NULL
  GROUP BY session_id
) s USING (session_id)
WHERE r.type IN ('user', 'assistant');

CREATE OR REPLACE TABLE content_items AS
WITH src AS (
  SELECT
    r.session_id,
    r.timestamp,
    r.project_path,
    r.source_file,
    r.source_line,
    r.data->'$.message.content' AS message_content,
    r.data->'$.toolUseResult'   AS tool_use_result
  FROM raw r
  WHERE r.type IN ('user', 'assistant')
)
SELECT
  s.session_id,
  s.timestamp,
  s.project_path,
  s.source_file,
  s.source_line,
  (item->>'$.type')        AS type,
  (item->>'$.name')        AS name,
  (item->>'$.id')          AS id,
  (item->>'$.tool_use_id') AS tool_use_id,
  (item->>'$.text')        AS text,
  (item->>'$.content')     AS content,
  CAST(item->>'$.is_error' AS BOOLEAN) AS is_error,
  item AS data,
  s.tool_use_result
FROM src s,
LATERAL (SELECT unnest(json_extract(s.message_content, '$[*]')) AS item) t
WHERE json_type(s.message_content) = 'ARRAY';

CREATE OR REPLACE VIEW tool_calls AS
SELECT
  name AS tool_name,
  id   AS tool_id,
  session_id,
  project_path,
  timestamp
FROM content_items
WHERE type = 'tool_use' AND name IS NOT NULL;

CREATE OR REPLACE VIEW tool_errors AS
SELECT
  er.tool_use_id   AS tool_id,
  er.content       AS error_content,
  COALESCE(tc.tool_name, 'unknown') AS tool_name,
  er.session_id,
  tc.project_path,
  er.timestamp,
  CASE WHEN er.tool_use_result::VARCHAR = '"User rejected tool use"'
       THEN 'rejection' ELSE 'failure' END AS error_type
FROM content_items er
LEFT JOIN tool_calls tc ON er.tool_use_id = tc.tool_id
WHERE er.type = 'tool_result' AND er.is_error;

CREATE OR REPLACE VIEW skill_calls AS
SELECT
  (data->>'$.input.skill') AS skill_name,
  NULLIF((data->>'$.input.args'), '') AS args,
  id AS tool_id,
  session_id,
  project_path,
  timestamp
FROM content_items
WHERE type = 'tool_use'
  AND name = 'Skill'
  AND (data->>'$.input.skill') IS NOT NULL;

CREATE OR REPLACE VIEW permission_requests AS
SELECT
  tc.name AS tool_name,
  tc.id   AS tool_id,
  (tc.data->>'$.input.command')     AS command,
  (tc.data->>'$.input.file_path')   AS file_path,
  (tc.data->>'$.input.description') AS description,
  tc.session_id,
  tc.project_path,
  tc.timestamp
FROM content_items er
JOIN content_items tc ON er.tool_use_id = tc.id
WHERE er.type = 'tool_result'
  AND er.tool_use_result::VARCHAR = '"User rejected tool use"';

CREATE OR REPLACE VIEW sandbox_bypasses AS
WITH bypass AS (
  SELECT
    (data->>'$.input.command')     AS command,
    (data->>'$.input.description') AS description,
    id AS tool_id,
    session_id,
    project_path,
    timestamp
  FROM content_items
  WHERE type = 'tool_use'
    AND name = 'Bash'
    AND (data->>'$.input.dangerouslyDisableSandbox') = 'true'
)
SELECT
  b.command,
  b.description,
  b.tool_id,
  b.session_id,
  b.project_path,
  b.timestamp,
  prior.tool_id AS retried_tool_id,
  prior.error   AS retried_error
FROM bypass b
LEFT JOIN LATERAL (
  SELECT tc.id AS tool_id, er.content AS error
  FROM content_items tc
  JOIN content_items er
    ON er.tool_use_id = tc.id AND er.type = 'tool_result' AND er.is_error
  WHERE tc.type = 'tool_use'
    AND tc.name = 'Bash'
    AND COALESCE((tc.data->>'$.input.dangerouslyDisableSandbox'), 'false') = 'false'
    AND tc.session_id = b.session_id
    AND tc.timestamp  < b.timestamp
    AND (tc.data->>'$.input.command') = b.command
  ORDER BY tc.timestamp DESC
  LIMIT 1
) prior ON true;

CREATE OR REPLACE VIEW text_content AS
WITH unified AS (
  SELECT
    ci.session_id,
    ci.timestamp,
    ci.project_path,
    m.type AS role,
    CASE WHEN m.type = 'assistant' THEN (m.data->>'$.message.model') END AS model,
    ci.text AS raw_text,
    ci.source_file,
    ci.source_line,
    ci.source_file LIKE '%/subagents/%' AS is_subagent,
    ci.text LIKE '<%' AS is_system
  FROM content_items ci
  JOIN messages m USING (source_file, source_line)
  WHERE ci.type = 'text'
    AND ci.text IS NOT NULL
    AND length(trim(ci.text)) > 0
    AND NOT m.is_meta

  UNION ALL

  SELECT
    m.session_id,
    m.timestamp,
    m.project_path,
    m.type AS role,
    NULL AS model,
    m.content_text AS raw_text,
    m.source_file,
    m.source_line,
    m.source_file LIKE '%/subagents/%' AS is_subagent,
    m.content_text LIKE '<%'
      OR m.content_text LIKE 'Implement the following plan:%'
      OR m.content_text LIKE 'This session is being continued from a previous conversation%'
    AS is_system
  FROM messages m
  WHERE m.type = 'user'
    AND m.content_text IS NOT NULL
    AND length(trim(m.content_text)) > 0
    AND NOT m.is_meta
)
SELECT
  session_id,
  timestamp,
  project_path,
  role,
  model,
  regexp_replace(
    regexp_replace(raw_text, '```.*?```', '', 'gs'),
    '`[^`\n]*`', '', 'g'
  ) AS text,
  raw_text,
  source_file,
  source_line,
  is_subagent,
  is_system
FROM unified;

CREATE OR REPLACE VIEW sessions AS
SELECT
  session_id,
  ANY_VALUE(summary) AS summary,
  MIN(timestamp) AS start_time,
  MAX(timestamp) AS end_time,
  MAX(timestamp) - MIN(timestamp) AS duration,
  ANY_VALUE(project_path) AS project_path,
  ANY_VALUE(git_branch)   AS git_branch,
  COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) AS user_messages,
  COUNT(*) FILTER (WHERE type = 'assistant')            AS assistant_messages
FROM messages
GROUP BY session_id
HAVING COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) > 0;
