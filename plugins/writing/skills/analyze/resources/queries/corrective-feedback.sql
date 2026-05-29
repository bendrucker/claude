-- Surface labeled-slop moments: short, human-authored user messages that
-- express frustration about writing quality, paired with the preceding model
-- output as context. The frustration lexicon is passed as a regex alternation
-- via the 'lexicon' variable. Pasted model output is excluded by length and by
-- the is_system/is_subagent flags already on text_content.
WITH per_message AS (
  SELECT
    tc.host,
    tc.session_id,
    s.project_path AS session_project_path,
    tc.source_file,
    tc.source_line,
    tc.timestamp,
    tc.role,
    tc.is_system,
    tc.is_subagent,
    string_agg(tc.text, E'\n' ORDER BY tc.source_line) AS message_text,
    SUM(length(tc.text)) AS chars
  FROM text_content tc
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
  GROUP BY tc.host, tc.session_id, s.project_path, tc.source_file, tc.source_line,
           tc.timestamp, tc.role, tc.is_system, tc.is_subagent
),
paired AS (
  SELECT
    *,
    LAG(role)         OVER w AS prev_role,
    LAG(message_text) OVER w AS prev_text,
    LAG(chars)        OVER w AS prev_chars,
    LAG(source_file)  OVER w AS prev_source_file,
    LAG(source_line)  OVER w AS prev_source_line
  FROM per_message
  WINDOW w AS (PARTITION BY host, session_id ORDER BY timestamp, source_file, source_line)
)
SELECT
  session_id,
  SPLIT_PART(session_project_path, '/', -1) AS project,
  timestamp,
  chars AS user_chars,
  message_text AS user_text,
  source_file AS user_source_file,
  source_line AS user_source_line,
  regexp_extract(lower(message_text), getvariable('lexicon')::VARCHAR) AS matched_term,
  prev_chars AS context_chars,
  LEFT(prev_text, 400) AS context_snippet
FROM paired
WHERE role = 'user'
  AND NOT is_system
  AND NOT is_subagent
  AND chars <= COALESCE(getvariable('max_user_chars')::BIGINT, 400)
  AND regexp_matches(lower(message_text), getvariable('lexicon')::VARCHAR)
ORDER BY timestamp DESC
LIMIT COALESCE(getvariable('limit')::BIGINT, 25);
