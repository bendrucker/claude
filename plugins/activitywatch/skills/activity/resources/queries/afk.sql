-- Active (not-afk) vs idle (afk) time from the AFK watcher: how much of the
-- window was actually at the keyboard.
-- Params: cutoff (epoch seconds; NULL for all-time).
WITH afk_events AS (
  SELECT
    json_extract_string(e.data, '$.status') AS status,
    (e.endtime - e.starttime) / 1e9 AS seconds
  FROM aw.events e
  JOIN aw.buckets b ON e.bucketrow = b.id
  WHERE b.type = 'afkstatus'
    AND (getvariable('cutoff') IS NULL OR e.starttime / 1e9 >= getvariable('cutoff'))
)
SELECT
  CASE status WHEN 'not-afk' THEN 'active' WHEN 'afk' THEN 'idle' ELSE status END AS state,
  CASE WHEN sum(seconds) >= 3600
       THEN (sum(seconds) // 3600)::bigint || 'h ' || ((sum(seconds) % 3600) // 60)::bigint || 'm'
       ELSE (sum(seconds) // 60)::bigint || 'm' END AS duration,
  round(sum(seconds)) AS seconds
FROM afk_events
GROUP BY status
ORDER BY seconds DESC;
