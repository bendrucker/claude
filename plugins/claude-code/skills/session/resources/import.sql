INSERT INTO messages (
  session_id,
  type,
  timestamp,
  project_path,
  git_branch,
  is_meta,
  content_text,
  item_type,
  tool_name,
  tool_id,
  tool_use_id,
  result_content,
  is_error,
  model,
  input_tokens,
  output_tokens,
  stop_reason,
  duration_ms,
  version,
  is_sidechain,
  source_file,
  source_line,
  summary
)
WITH raw AS (
  SELECT
    *,
    ROW_NUMBER() OVER () as source_line
  FROM read_ndjson(
    getvariable('source'),
    ignore_errors=true,
    union_by_name=true,
    columns={
      type: 'VARCHAR',
      sessionId: 'VARCHAR',
      timestamp: 'VARCHAR',
      cwd: 'VARCHAR',
      gitBranch: 'VARCHAR',
      isMeta: 'BOOLEAN',
      isSidechain: 'BOOLEAN',
      summary: 'VARCHAR',
      message: 'JSON',
      durationMs: 'BIGINT',
      version: 'VARCHAR'
    },
    filename=true
  )
  WHERE type IN ('user', 'assistant', 'summary')
),
summaries AS (
  SELECT sessionId as session_id, summary
  FROM raw
  WHERE type = 'summary'
),
string_content AS (
  SELECT
    r.sessionId as session_id,
    r.type,
    r.timestamp,
    r.cwd as project_path,
    r.gitBranch as git_branch,
    COALESCE(r.isMeta, false) as is_meta,
    json_extract_string(r.message, '$.content') as content_text,
    NULL as item_type,
    NULL as tool_name,
    NULL as tool_id,
    NULL as tool_use_id,
    NULL as result_content,
    false as is_error,
    json_extract_string(r.message, '$.model') as model,
    json_extract(r.message, '$.usage.input_tokens')::BIGINT as input_tokens,
    json_extract(r.message, '$.usage.output_tokens')::BIGINT as output_tokens,
    json_extract_string(r.message, '$.stop_reason') as stop_reason,
    r.durationMs as duration_ms,
    r.version,
    COALESCE(r.isSidechain, false) as is_sidechain,
    r.filename as source_file,
    r.source_line
  FROM raw r
  WHERE r.type IN ('user', 'assistant')
    AND json_extract(r.message, '$.content') IS NOT NULL
    AND json_type(json_extract(r.message, '$.content')) = 'VARCHAR'
),
array_content AS (
  SELECT
    r.sessionId as session_id,
    r.type,
    r.timestamp,
    r.cwd as project_path,
    r.gitBranch as git_branch,
    COALESCE(r.isMeta, false) as is_meta,
    json_extract_string(r.message, '$.content') as content_text,
    json_extract_string(r.message, '$.content[' || s.idx || '].type') as item_type,
    json_extract_string(r.message, '$.content[' || s.idx || '].name') as tool_name,
    json_extract_string(r.message, '$.content[' || s.idx || '].id') as tool_id,
    json_extract_string(r.message, '$.content[' || s.idx || '].tool_use_id') as tool_use_id,
    json_extract_string(r.message, '$.content[' || s.idx || '].content') as result_content,
    COALESCE(
      json_extract(r.message, '$.content[' || s.idx || '].is_error')::BOOLEAN,
      false
    ) as is_error,
    json_extract_string(r.message, '$.model') as model,
    json_extract(r.message, '$.usage.input_tokens')::BIGINT as input_tokens,
    json_extract(r.message, '$.usage.output_tokens')::BIGINT as output_tokens,
    json_extract_string(r.message, '$.stop_reason') as stop_reason,
    r.durationMs as duration_ms,
    r.version,
    COALESCE(r.isSidechain, false) as is_sidechain,
    r.filename as source_file,
    r.source_line
  FROM raw r,
  LATERAL (
    SELECT unnest(generate_series(
      0::BIGINT,
      CAST(json_array_length(json_extract(r.message, '$.content')) AS BIGINT) - 1
    )) as idx
  ) s
  WHERE r.type IN ('user', 'assistant')
    AND json_extract(r.message, '$.content') IS NOT NULL
    AND json_type(json_extract(r.message, '$.content')) = 'ARRAY'
    AND json_array_length(json_extract(r.message, '$.content')) > 0
),
all_content AS (
  SELECT * FROM string_content
  UNION ALL
  SELECT * FROM array_content
)
SELECT
  ac.*,
  su.summary
FROM all_content ac
LEFT JOIN summaries su USING (session_id);

DELETE FROM meta;
INSERT INTO meta VALUES (CURRENT_TIMESTAMP);
