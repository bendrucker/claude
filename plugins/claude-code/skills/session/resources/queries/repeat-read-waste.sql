-- What fraction of Read calls re-read a file already read earlier in the same session,
-- and how many characters those repeat reads re-injected into context. Self-joins each
-- Read tool_use to its tool_result, ranks reads within (session, file) by time, and
-- counts every read after the first as a repeat. Surfaces re-reading as a context-tax
-- lever (the result is often surprisingly high).
-- Params: after_date, before_date, project, host.
WITH reads AS (
  SELECT
    tr.host,
    tr.session_id,
    tc.file_path,
    length(tr.content)              AS chars,
    tr.timestamp,
    tr.source_line
  FROM content_items tr
  JOIN tool_calls tc
    ON tr.tool_use_id = tc.tool_id AND tr.host = tc.host
   AND tc.tool_name = 'Read'
  JOIN sessions s ON s.host = tr.host AND s.session_id = tr.session_id
  WHERE tr.type = 'tool_result'
    AND tr.content IS NOT NULL
    AND tc.file_path IS NOT NULL
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
ranked AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY host, session_id, file_path
      ORDER BY timestamp, source_line
    ) AS rn
  FROM reads
)
SELECT
  host,
  COUNT(*)                                       AS total_reads,
  COUNT(*) FILTER (WHERE rn > 1)                 AS repeat_reads,
  ROUND(100.0 * COUNT(*) FILTER (WHERE rn > 1) / COUNT(*), 1) AS repeat_pct,
  SUM(chars) FILTER (WHERE rn > 1)               AS repeat_chars,
  ROUND(SUM(chars) FILTER (WHERE rn > 1) / 4.0 / 1000.0, 1) AS repeat_ktokens
FROM ranked
GROUP BY host
ORDER BY host;
