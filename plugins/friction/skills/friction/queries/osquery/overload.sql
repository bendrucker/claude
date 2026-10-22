-- Minutes over 2x and 3x the Studio's 10 cores, per day.
SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day,
  count(*) FILTER (WHERE load1 > 20) // 6 AS mins_gt2x, count(*) FILTER (WHERE load1 > 30) // 6 AS mins_gt3x,
  round(max(load1)) AS peak
FROM pressure GROUP BY day ORDER BY day;
