-- Saturated minutes per day, and the lowest minute's average idle share.
SELECT day, count(*) FILTER (WHERE saturated) AS saturated_mins, round(min(idle_pct), 1) AS min_idle_pct
FROM host_min GROUP BY day ORDER BY day;
