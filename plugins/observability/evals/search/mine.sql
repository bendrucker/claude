-- Search terms agents used, as label seeds. Run read-only on a frozen copy:
--   duckdb -readonly -json -init ../../skills/session/resources/limits.sql <db> < mine.sql
-- `named` is search.sql's query variable; `adhoc` is the pattern of an ILIKE an agent wrote
-- against session prose instead.
WITH bash AS (
  SELECT session_id, timestamp, command FROM tool_calls
  WHERE tool_name = 'Bash' AND command LIKE '%duckdb%'
),
terms AS (
  SELECT 'named' AS source, regexp_extract(command, $$query\W*=\s*'((?:[^']|'')+)'$$, 1) AS term, session_id, timestamp
  FROM bash WHERE command LIKE '%search.sql%'
  UNION ALL
  SELECT 'adhoc', unnest(regexp_extract_all(command, $$(?i)(?:label|text|content_text|prompt_text)\s+i?like\s+'%([^%']{3,})%'$$, 1)), session_id, timestamp
  FROM bash WHERE command NOT LIKE '%search.sql%'
)
SELECT source, lower(replace(term, '''''', '''')) AS term, count(*) AS uses,
  count(DISTINCT session_id) AS sessions, max(timestamp)::DATE AS last_used
FROM terms WHERE term <> ''
GROUP BY ALL
ORDER BY uses DESC, last_used DESC;
