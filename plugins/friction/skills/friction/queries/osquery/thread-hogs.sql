-- Names holding runnable threads during overload. Empty when the config predates proc_groups.
SELECT strftime(to_timestamp(g.t), '%Y-%m-%d') AS day, pname,
  round(avg(thr)) AS avg_threads, round(sum(dcpu) / 1000 / 60, 1) AS cpu_minutes
FROM groups g JOIN pressure p ON p.t BETWEEN g.t - 5 AND g.t + 5
WHERE p.load1 > 3 * getvariable('cores') GROUP BY day, pname ORDER BY day, cpu_minutes DESC;
