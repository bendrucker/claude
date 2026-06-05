-- Hook overfiring analysis. Groups blocking hook events by hook and a normalized
-- reason signature (quoted spans and whitespace collapsed), so a hook that fires on
-- many targets with the same message aggregates into one row. `storm_sessions` counts
-- sessions where the same signature blocked two or more times (the model getting
-- blocked, retrying, and blocked again) and `max_burst` is the worst single session;
-- together they distinguish a smooth one-shot redirect from a hook the model fights.
-- Params: after_date, before_date, project, host, hook (GLOB on command/name).
WITH bl AS (
  SELECT
    hb.*,
    COALESCE(hb.command, hb.hook_name) AS hook,
    substr(
      regexp_replace(
        regexp_replace(trim(COALESCE(hb.reason, '(no reason)')), '"[^"]*"', '"_"', 'g'),
        '\s+', ' ', 'g'
      ), 1, 80
    ) AS signature
  FROM hook_blocks hb
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND (getvariable('hook') IS NULL OR COALESCE(hb.command, hb.hook_name) GLOB getvariable('hook')::VARCHAR)
),
per_session AS (
  SELECT hook, signature, host, session_id, COUNT(*) AS n
  FROM bl
  GROUP BY hook, signature, host, session_id
),
storms AS (
  SELECT hook, signature, COUNT(*) FILTER (WHERE n >= 2) AS storm_sessions, MAX(n) AS max_burst
  FROM per_session
  GROUP BY hook, signature
)
SELECT
  bl.hook,
  bl.signature,
  COUNT(*)                                          AS blocks,
  COUNT(*) FILTER (WHERE bl.decision IN ('deny', 'block')) AS denies,
  COUNT(*) FILTER (WHERE bl.decision = 'ask')       AS asks,
  COUNT(DISTINCT (bl.host, bl.session_id))          AS sessions,
  st.storm_sessions,
  st.max_burst,
  string_agg(DISTINCT bl.hook_event, ',')           AS events,
  MAX(bl.timestamp)                                 AS last_seen
FROM bl
JOIN storms st USING (hook, signature)
GROUP BY bl.hook, bl.signature, st.storm_sessions, st.max_burst
ORDER BY blocks DESC, bl.hook;
