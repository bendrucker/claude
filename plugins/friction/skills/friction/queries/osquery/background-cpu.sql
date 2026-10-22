-- Processes averaging over 0.03 cores across more than 20 hours. Needs a window of 2+ days to fire.
SELECT pname, round(sum(dcpu) / 1000 / (max(t) - min(t)), 3) AS avg_cores
FROM cpu GROUP BY pname, pid, st
HAVING max(t) - min(t) > 72000 AND sum(dcpu) / 1000 / (max(t) - min(t)) > 0.03
ORDER BY avg_cores DESC;
