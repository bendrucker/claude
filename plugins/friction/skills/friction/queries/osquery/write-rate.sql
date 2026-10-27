-- The 3 names with the highest one-minute writes per day, and their minutes over 1 GiB. Per-process deltas, since a name's total jumps as members come and go.
WITH m AS (
  SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, pname, t // 60 AS m, sum(ddw) AS w
  FROM cpu GROUP BY day, pname, m)
SELECT day, pname, count(*) FILTER (WHERE w > 2^30) AS heavy_mins, round(max(w) / 2^30, 2) AS peak_gb_per_min
FROM m WHERE w > 0 GROUP BY day, pname
QUALIFY row_number() OVER (PARTITION BY day ORDER BY max(w) DESC) <= 3
ORDER BY day, peak_gb_per_min DESC;
