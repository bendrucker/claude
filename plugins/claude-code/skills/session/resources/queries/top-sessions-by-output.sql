-- Rank sessions by total output tokens (with row count and per-row average) to surface
-- runaway or unattended sessions: a huge output total spread over many rows is the
-- signature of a loop left running.
-- Params: after_date, before_date, project, host, limit (default 15).
WITH a AS (
  SELECT r.host, r.session_id, r.project_path, r.output_tokens
  FROM raw r
  WHERE r.type = 'assistant'
    AND date_filter(r.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(r.project_path, getvariable('project'))
    AND host_filter(r.host, getvariable('host'))
)
SELECT
  session_id,
  host,
  regexp_extract(project_path, '[^/]+$') AS repo,
  SUM(output_tokens)        AS out_tokens,
  COUNT(*)                  AS nrows,
  ROUND(AVG(output_tokens), 0) AS avg_out
FROM a
GROUP BY session_id, host, repo
ORDER BY out_tokens DESC NULLS LAST
LIMIT COALESCE(getvariable('limit'), 15);
