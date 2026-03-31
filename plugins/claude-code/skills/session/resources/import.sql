CREATE OR REPLACE TEMP TABLE new_raw AS
SELECT
  * EXCLUDE (message, filename),
  message.content as message_content,
  message.type as message_type,
  message.id as message_id,
  message.container as message_container,
  message.* EXCLUDE (content, type, id, container),
  filename as source_file,
  ROW_NUMBER() OVER () as source_line
FROM read_ndjson(
  getvariable('source'),
  ignore_errors=true,
  union_by_name=true,
  filename=true
)
WHERE type IN ('user', 'assistant', 'summary');

SET VARIABLE changed_sessions = (
  SELECT COALESCE(LIST(DISTINCT sessionId), []) FROM new_raw
);

CREATE OR REPLACE TABLE raw AS
SELECT * FROM raw
WHERE sessionId NOT IN (SELECT unnest(getvariable('changed_sessions'))::VARCHAR)
UNION ALL BY NAME
SELECT * FROM new_raw;

DROP TABLE new_raw;

CREATE OR REPLACE TEMP TABLE content_items_export AS
SELECT (
  substr(item::VARCHAR, 1, length(item::VARCHAR) - 1) || ',' ||
  ltrim(json_object(
    'session_id', sessionId::VARCHAR,
    'source_file', source_file,
    'source_line', source_line,
    'timestamp', timestamp,
    'project_path', cwd,
    'tool_use_result', toolUseResult
  )::VARCHAR, '{')
)::VARCHAR as line
FROM raw,
LATERAL (SELECT unnest(json_extract(message_content, '$[*]')) as item) t
WHERE type IN ('user', 'assistant')
  AND message_content IS NOT NULL
  AND json_type(message_content) = 'ARRAY'
  AND json_array_length(message_content) > 0;

DELETE FROM meta;
INSERT INTO meta VALUES (CURRENT_TIMESTAMP);
