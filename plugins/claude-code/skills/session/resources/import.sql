CREATE OR REPLACE TABLE raw AS
SELECT
  * EXCLUDE (message, filename),
  message.content as message_content,
  message.* EXCLUDE (content),
  filename as source_file,
  ROW_NUMBER() OVER (PARTITION BY filename) as source_line
FROM read_ndjson(
  getvariable('projects_glob'),
  ignore_errors=true,
  union_by_name=true,
  filename=true
)
WHERE type IN ('user', 'assistant', 'summary');

-- views.sql references `summary` directly; corpora without any summary-type
-- rows won't have the column auto-detected, so add it defensively.
ALTER TABLE raw ADD COLUMN IF NOT EXISTS summary VARCHAR;

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
