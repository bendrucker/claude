-- Names writing over 1 GiB in one minute, per day. Per-process deltas, since a name's total jumps as members come and go.
WITH m AS (
  SELECT strftime(to_timestamp(t), '%Y-%m-%d') AS day, pname, t // 60 AS m, sum(ddw) AS w
  FROM cpu GROUP BY day, pname, m)
SELECT day, pname, count(*) AS heavy_mins, round(max(w) / 2^30, 1) AS peak_gb_per_min
FROM m WHERE w > 2^30 GROUP BY day, pname ORDER BY day, heavy_mins DESC;
