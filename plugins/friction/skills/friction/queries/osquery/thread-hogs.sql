-- Names holding the CPU while it is saturated. Empty when the config predates proc_groups or host_cpu.
SELECT h.day, pname, round(avg(thr)) AS avg_threads, round(sum(dcpu) / 1000 / 60, 1) AS cpu_minutes
FROM groups g JOIN host_min h ON h.m = g.t // 60
WHERE h.saturated GROUP BY h.day, pname ORDER BY h.day, cpu_minutes DESC;
