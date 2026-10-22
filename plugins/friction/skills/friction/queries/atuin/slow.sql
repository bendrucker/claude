-- Command heads whose median run is over 30 s, per day.
SELECT day, head, count(*) AS runs,
  round(median(duration) / 1e9) AS median_s, round(sum(duration) / 6e10) AS total_min
FROM runs GROUP BY day, head HAVING median(duration) > 30e9 ORDER BY day, total_min DESC;
