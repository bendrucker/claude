CREATE OR REPLACE TEMP TABLE new_raw AS
SELECT
  * EXCLUDE (message, filename),
  message.* EXCLUDE (content),
  message.content as message_content,
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

DELETE FROM meta;
INSERT INTO meta VALUES (CURRENT_TIMESTAMP);
