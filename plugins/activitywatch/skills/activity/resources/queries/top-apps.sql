-- Time spent focused in each app, most first: the headline "what did I use" view.
-- Duration = endtime - starttime (nanoseconds) summed per app.
-- Params: cutoff (epoch seconds; NULL for all-time), limit (row cap).
WITH app_events AS (
  SELECT
    json_extract_string(e.data, '$.app') AS app,
    (e.endtime - e.starttime) / 1e9 AS seconds
  FROM aw.events e
  JOIN aw.buckets b ON e.bucketrow = b.id
  WHERE b.type = 'currentwindow'
    AND (getvariable('cutoff') IS NULL OR e.starttime / 1e9 >= getvariable('cutoff'))
)
SELECT
  app,
  CASE WHEN sum(seconds) >= 3600
       THEN (sum(seconds) // 3600)::bigint || 'h ' || ((sum(seconds) % 3600) // 60)::bigint || 'm'
       ELSE (sum(seconds) // 60)::bigint || 'm' END AS duration,
  round(sum(seconds)) AS seconds,
  count(*) AS focus_events
FROM app_events
GROUP BY app
ORDER BY seconds DESC
LIMIT getvariable('limit');
