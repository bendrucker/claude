-- Share of saturated minutes with a bun or duckdb group within 2 minutes, against other minutes.
-- Groups sample every 10 s, so they catch jobs that start and exit between procs samples.
WITH jm AS (SELECT DISTINCT t // 60 AS m FROM groups WHERE pname IN ('bun', 'duckdb'))
SELECT day, saturated, count(*) AS mins,
  round(100 * avg(EXISTS (SELECT 1 FROM jm WHERE jm.m BETWEEN hm.m - 2 AND hm.m + 2)::INT)) AS pct_with_job
FROM host_min hm GROUP BY day, saturated ORDER BY day, saturated;
