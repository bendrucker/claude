-- Sessions that re-inject the full skill catalog and deferred-tools delta many times,
-- cumulatively re-billing the same context (the token-thrash detector). Counts
-- skill_listing and deferred_tools_delta injections per session with an estimated token
-- total; tune the floor via min_injections.
-- Params: after_date, before_date, project, host, min_injections (default 6).
WITH att AS (
  SELECT a.host, a.session_id, a.project_path, a.kind, a.attachment
  FROM attachments a
  JOIN sessions s USING (host, session_id)
  WHERE a.kind IN ('skill_listing', 'deferred_tools_delta')
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
per AS (
  SELECT
    host,
    session_id,
    regexp_extract(project_path, '[^/]+$')                  AS repo,
    COUNT(*) FILTER (WHERE kind = 'skill_listing')          AS skill_listings,
    COUNT(*) FILTER (WHERE kind = 'deferred_tools_delta')   AS tool_deltas,
    SUM(length(attachment::VARCHAR))                        AS chars
  FROM att
  GROUP BY host, session_id, project_path
)
SELECT
  host,
  session_id,
  repo,
  skill_listings,
  tool_deltas,
  ROUND(chars / 4.0 / 1000.0) AS est_ktokens
FROM per
WHERE skill_listings + tool_deltas > COALESCE(getvariable('min_injections'), 6)
ORDER BY est_ktokens DESC
LIMIT 20;
