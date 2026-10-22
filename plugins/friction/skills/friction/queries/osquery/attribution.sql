-- Share of overload minutes with a bun or duckdb process within 2 minutes, against quiet minutes.
WITH pm AS (SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, t // 60 AS m, max(load1) AS l FROM pressure GROUP BY 1, 2),
jm AS (SELECT DISTINCT t // 60 AS m FROM cpu WHERE pname IN ('bun', 'duckdb'))
SELECT day, l > 3 * getvariable('cores') AS overloaded, count(*) AS mins,
  round(100 * avg(EXISTS (SELECT 1 FROM jm WHERE jm.m BETWEEN pm.m - 2 AND pm.m + 2)::INT)) AS pct_with_job
FROM pm GROUP BY day, overloaded ORDER BY day, overloaded;
