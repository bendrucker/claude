-- Focus events in reverse-chronological order: when you switched to what and for
-- how long. Pair with --recent 1d to reconstruct a single day.
-- Params: cutoff (epoch seconds; NULL for all-time), limit (row cap).
SELECT
  to_timestamp(e.starttime / 1e9) AS started,
  round((e.endtime - e.starttime) / 1e9) AS seconds,
  json_extract_string(e.data, '$.app') AS app,
  json_extract_string(e.data, '$.title') AS title
FROM aw.events e
JOIN aw.buckets b ON e.bucketrow = b.id
WHERE b.type = 'currentwindow'
  AND (getvariable('cutoff') IS NULL OR e.starttime / 1e9 >= getvariable('cutoff'))
ORDER BY e.starttime DESC
LIMIT getvariable('limit');
