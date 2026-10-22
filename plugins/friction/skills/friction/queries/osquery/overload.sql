-- Minutes with load over 2x and 3x the machine's cores, per day.
SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day,
  count(*) FILTER (WHERE load1 > 2 * getvariable('cores')) // 6 AS mins_gt2x,
  count(*) FILTER (WHERE load1 > 3 * getvariable('cores')) // 6 AS mins_gt3x,
  round(max(load1)) AS peak
FROM pressure GROUP BY day ORDER BY day;
