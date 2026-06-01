WITH per_message AS (
  SELECT
    tc.host,
    tc.session_id,
    s.project_path AS session_project_path,
    tc.source_file,
    tc.source_line,
    tc.timestamp,
    tc.role,
    string_agg(tc.text, E'\n' ORDER BY tc.source_line) AS message_text,
    SUM(length(tc.text)) AS chars
  FROM text_content tc
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND NOT tc.is_subagent
    AND (tc.role = 'assistant' OR NOT tc.is_system)
  GROUP BY tc.host, tc.session_id, s.project_path, tc.source_file, tc.source_line, tc.timestamp, tc.role
),
paired AS (
  SELECT
    *,
    LEAD(role)        OVER w AS next_role,
    LEAD(message_text) OVER w AS next_text,
    LEAD(chars)       OVER w AS next_chars,
    LEAD(timestamp)   OVER w AS next_timestamp,
    LEAD(source_file) OVER w AS next_source_file,
    LEAD(source_line) OVER w AS next_source_line
  FROM per_message
  WINDOW w AS (PARTITION BY host, session_id ORDER BY timestamp, source_file, source_line)
),
candidates AS (
  SELECT
    session_id,
    SPLIT_PART(session_project_path, '/', -1) AS project,
    timestamp        AS assistant_timestamp,
    next_timestamp   AS user_timestamp,
    chars            AS assistant_chars,
    next_chars       AS user_chars,
    LEFT(message_text, 200) AS assistant_snippet,
    LEFT(next_text, 200)    AS user_snippet,
    source_file      AS assistant_source_file,
    source_line      AS assistant_source_line,
    next_source_file AS user_source_file,
    next_source_line AS user_source_line
  FROM paired
  WHERE role = 'assistant'
    AND next_role = 'user'
    AND chars >= COALESCE(getvariable('min_assistant_chars')::BIGINT, 300)
    AND next_chars <= COALESCE(getvariable('max_user_chars')::BIGINT, 250)
)
SELECT * FROM candidates
USING SAMPLE reservoir(30 ROWS) REPEATABLE(42);
