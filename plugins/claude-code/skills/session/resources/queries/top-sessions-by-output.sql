-- Rank sessions by total output tokens (deduped per message via message_usage; summing
-- raw rows inflates totals 2-3.5x because every content-block row repeats the parent
-- message's usage). Surfaces runaway or unattended sessions: a huge output total spread
-- over many messages is the signature of a loop left running.
-- Params: after_date, before_date, project, host, limit (default 15).
WITH a AS (
  SELECT mu.host, mu.session_id, mu.project_path, mu.output_tokens
  FROM message_usage mu
  WHERE date_filter(mu.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(mu.project_path, getvariable('project'))
    AND host_filter(mu.host, getvariable('host'))
)
SELECT
  session_id,
  host,
  regexp_extract(project_path, '[^/]+$') AS repo,
  SUM(output_tokens)        AS out_tokens,
  COUNT(*)                  AS messages,
  ROUND(AVG(output_tokens), 0) AS avg_out
FROM a
GROUP BY session_id, host, repo
ORDER BY out_tokens DESC NULLS LAST
LIMIT COALESCE(getvariable('limit'), 15);
