-- Minutes with under 5% of CPU ticks idle in every sample, per day.
WITH m AS (
  SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, t // 60 AS m, max(idle_pct) AS idle
  FROM host GROUP BY day, m)
SELECT day, count(*) FILTER (WHERE idle < 5) AS saturated_mins, round(min(idle), 1) AS min_idle_pct
FROM m GROUP BY day ORDER BY day;
