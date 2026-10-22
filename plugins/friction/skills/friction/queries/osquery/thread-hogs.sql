-- Names holding the CPU while it is saturated. Empty when the config predates proc_groups or host_cpu.
SELECT strftime(to_timestamp(g.t), '%Y-%m-%d') AS day, pname,
  round(avg(thr)) AS avg_threads, round(sum(dcpu) / 1000 / 60, 1) AS cpu_minutes
FROM groups g JOIN host h ON h.t BETWEEN g.t - 5 AND g.t + 5
WHERE h.idle_pct < 5 GROUP BY day, pname ORDER BY day, cpu_minutes DESC;
