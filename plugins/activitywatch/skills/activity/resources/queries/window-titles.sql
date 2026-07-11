-- Time per window title within each app: what you were actually doing, not just
-- which app was open. Needs Accessibility granted to ActivityWatch for titles.
-- Params: cutoff (epoch seconds; NULL for all-time), limit (row cap).
WITH title_events AS (
  SELECT
    json_extract_string(e.data, '$.app') AS app,
    json_extract_string(e.data, '$.title') AS title,
    (e.endtime - e.starttime) / 1e9 AS seconds
  FROM aw.events e
  JOIN aw.buckets b ON e.bucketrow = b.id
  WHERE b.type = 'currentwindow'
    AND (getvariable('cutoff') IS NULL OR e.starttime / 1e9 >= getvariable('cutoff'))
)
SELECT
  app,
  title,
  CASE WHEN sum(seconds) >= 3600
       THEN (sum(seconds) // 3600)::bigint || 'h ' || ((sum(seconds) % 3600) // 60)::bigint || 'm'
       ELSE (sum(seconds) // 60)::bigint || 'm' END AS duration,
  round(sum(seconds)) AS seconds,
  count(*) AS focus_events
FROM title_events
GROUP BY app, title
ORDER BY seconds DESC
LIMIT getvariable('limit');
