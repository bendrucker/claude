CREATE OR REPLACE TEMP TABLE new_raw AS
SELECT
  json->>'$.sessionId'                                AS session_id,
  json->>'$.type'                                     AS type,
  json->>'$.cwd'                                      AS project_path,
  json->>'$.gitBranch'                                AS git_branch,
  COALESCE(CAST(json->>'$.isMeta'      AS BOOLEAN), false) AS is_meta,
  COALESCE(CAST(json->>'$.isSidechain' AS BOOLEAN), false) AS is_sidechain,
  CAST(json->>'$.durationMs' AS BIGINT)               AS duration_ms,
  CAST(json->>'$.timestamp'  AS TIMESTAMP)            AS timestamp,
  json->>'$.summary'                                  AS summary,
  CAST(json->>'$.message.usage.input_tokens'  AS BIGINT) AS input_tokens,
  CAST(json->>'$.message.usage.output_tokens' AS BIGINT) AS output_tokens,
  filename                                            AS source_file,
  ROW_NUMBER() OVER (PARTITION BY filename)           AS source_line,
  json                                                AS data
FROM read_json_objects(
  getvariable('source'),
  format='newline_delimited',
  ignore_errors=true,
  filename=true
)
WHERE json->>'$.type' IN ('user', 'assistant', 'summary');

SET VARIABLE changed_sessions = (
  SELECT COALESCE(LIST(DISTINCT session_id), []) FROM new_raw
);

CREATE OR REPLACE TABLE raw AS
SELECT * FROM raw
WHERE session_id NOT IN (SELECT unnest(getvariable('changed_sessions'))::VARCHAR)
UNION ALL
SELECT * FROM new_raw;

DROP TABLE new_raw;

DELETE FROM meta;
INSERT INTO meta VALUES (CURRENT_TIMESTAMP);
