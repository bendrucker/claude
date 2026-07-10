-- Imports one file: getvariable('source_path') for getvariable('host'), with the
-- scanned stat carried in source_mtime/source_size. Runs once per changed file.
-- Deleting and re-inserting exactly the file's rows (instead of rewriting the whole
-- table) keeps freed blocks reusable after the CHECKPOINT that ends the import run,
-- so the database file stays proportional to the corpus.
BEGIN;

DELETE FROM raw
WHERE host = getvariable('host')
  AND source_file = getvariable('source_path');

-- ROW_NUMBER() OVER () with no ORDER BY relies on the scan preserving file order.
-- A single-file scan holds that in practice, but it is formally undefined; and
-- ignore_errors skips unparseable lines, so source_line can trail the physical
-- line number in files with malformed lines.
INSERT INTO raw
SELECT
  getvariable('host')                                 AS host,
  json->>'$.sessionId'                                AS session_id,
  json->>'$.type'                                     AS type,
  json->>'$.cwd'                                      AS project_path,
  json->>'$.gitBranch'                                AS git_branch,
  COALESCE(TRY_CAST(json->>'$.isMeta'      AS BOOLEAN), false) AS is_meta,
  COALESCE(TRY_CAST(json->>'$.isSidechain' AS BOOLEAN), false) AS is_sidechain,
  TRY_CAST(json->>'$.durationMs' AS BIGINT)           AS duration_ms,
  TRY_CAST(json->>'$.timestamp'  AS TIMESTAMP)        AS timestamp,
  json->>'$.summary'                                  AS summary,
  TRY_CAST(json->>'$.message.usage.input_tokens'  AS BIGINT) AS input_tokens,
  TRY_CAST(json->>'$.message.usage.output_tokens' AS BIGINT) AS output_tokens,
  filename                                            AS source_file,
  ROW_NUMBER() OVER ()                                AS source_line,
  json                                                AS data
FROM read_json_objects(
  getvariable('source_path'),
  format='newline_delimited',
  ignore_errors=true,
  filename=true
);

DELETE FROM indexed_files
WHERE host = getvariable('host')
  AND path = getvariable('source_path');

INSERT INTO indexed_files
VALUES (
  getvariable('host'),
  getvariable('source_path'),
  TRY_CAST(getvariable('source_mtime') AS BIGINT),
  TRY_CAST(getvariable('source_size')  AS BIGINT)
);

COMMIT;
