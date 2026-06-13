-- Plan-mode usage: sessions that used ExitPlanMode, with replan counts and outcome
-- distribution. Sessions with plan_count >= 2 are replan candidates; >= 3 are
-- off-rails candidates (the user redirected repeatedly before approving or giving up).
-- Params: after_date, before_date, project, host, min_plans (minimum plan_count, default 1).
WITH filtered AS (
  SELECT ps.*
  FROM plan_sessions ps
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(ps.project_path, getvariable('project'))
    AND host_filter(ps.host, getvariable('host'))
    AND ps.plan_count >= COALESCE(TRY_CAST(getvariable('min_plans') AS INTEGER), 1)
)
SELECT
  f.host,
  f.session_id,
  SPLIT_PART(f.project_path, '/', -1)            AS project,
  f.plan_count,
  f.redirect_count,
  f.approved_count,
  f.unknown_count,
  CASE
    WHEN f.plan_count >= 3 THEN 'off-rails'
    WHEN f.plan_count >= 2 THEN 'replan'
    ELSE 'single'
  END                                             AS replan_tier,
  strftime(f.first_plan_ts, '%Y-%m-%d %H:%M')    AS first_plan,
  strftime(f.last_plan_ts,  '%Y-%m-%d %H:%M')    AS last_plan,
  s.summary
FROM filtered f
JOIN sessions s USING (host, session_id)
ORDER BY f.plan_count DESC, f.first_plan_ts DESC;
