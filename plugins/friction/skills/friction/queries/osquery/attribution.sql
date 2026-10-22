-- Share of saturated minutes with a bun or duckdb process within 2 minutes, against other minutes.
WITH hm AS (
  SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, t // 60 AS m, max(idle_pct) < 5 AS saturated
  FROM host GROUP BY day, m),
jm AS (SELECT DISTINCT t // 60 AS m FROM cpu WHERE pname IN ('bun', 'duckdb'))
SELECT day, saturated, count(*) AS mins,
  round(100 * avg(EXISTS (SELECT 1 FROM jm WHERE jm.m BETWEEN hm.m - 2 AND hm.m + 2)::INT)) AS pct_with_job
FROM hm GROUP BY day, saturated ORDER BY day, saturated;
