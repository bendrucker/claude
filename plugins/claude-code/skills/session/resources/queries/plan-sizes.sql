-- Weekly trend of plan sizes, the steering metric for the plan plugin's
-- ExitPlanMode size gate. One row per week, each plan session assigned to the
-- week of its first present. First-present chars measure how big plans arrive;
-- final-present chars (max plan_seq per session) measure what the gate lets
-- through. finals_near_threshold counts finals in [threshold - 2000, threshold],
-- the bunching-under-the-cap signal.
-- Params: after_date, before_date, project, host, threshold (default 12000).
WITH filtered AS (
  SELECT pc.host, pc.session_id, pc.timestamp, pc.plan_seq, pc.plan_chars
  FROM plan_calls pc
  WHERE date_filter(pc.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(pc.project_path, getvariable('project'))
    AND host_filter(pc.host, getvariable('host'))
),
per_session AS (
  SELECT
    host,
    session_id,
    date_trunc('week', MIN(timestamp))              AS week,
    MAX(CASE WHEN plan_seq = 1 THEN plan_chars END) AS first_chars,
    arg_max(plan_chars, plan_seq)                   AS final_chars
  FROM filtered
  GROUP BY host, session_id
),
params AS (
  SELECT COALESCE(TRY_CAST(getvariable('threshold') AS INTEGER), 12000) AS threshold
)
SELECT
  strftime(ps.week, '%Y-%m-%d')                        AS week,
  COUNT(*)                                             AS plan_sessions,
  ROUND(median(ps.first_chars))                        AS first_p50,
  ROUND(quantile_cont(ps.first_chars, 0.9))            AS first_p90,
  ROUND(median(ps.final_chars))                        AS final_p50,
  ROUND(quantile_cont(ps.final_chars, 0.9))            AS final_p90,
  COUNT(*) FILTER (ps.final_chars > p.threshold)       AS finals_over_threshold,
  COUNT(*) FILTER (ps.final_chars BETWEEN p.threshold - 2000 AND p.threshold)
                                                       AS finals_near_threshold
FROM per_session ps
CROSS JOIN params p
GROUP BY ps.week
ORDER BY ps.week;
