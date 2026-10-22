-- Seconds at memory pressure level 2 or above, per day.
SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, count(*) FILTER (WHERE lvl >= 2) * 10 AS warn_s,
  max(swap) AS max_swap_mb, min(avail) AS min_avail_pct
FROM pressure GROUP BY day ORDER BY day;
