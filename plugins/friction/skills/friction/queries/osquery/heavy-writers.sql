-- Processes writing over 1 GiB in a day.
SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, pname, any_value(cwd) AS cwd,
  round(max(fp) / 2^30, 1) AS fp_gb, round(sum(ddw) / 2^30, 1) AS written_gb
FROM cpu GROUP BY day, pname, pid, st HAVING sum(ddw) > 2^30 ORDER BY day, written_gb DESC;
