-- Command heads failing at least a third of the time, with 5+ runs a day.
SELECT day, head, count(*) AS runs, round(avg((exit != 0)::INT), 2) AS fail_rate
FROM runs GROUP BY day, head HAVING count(*) >= 5 AND avg((exit != 0)::INT) >= 0.33 ORDER BY day, runs DESC;
