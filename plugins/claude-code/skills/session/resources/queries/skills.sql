WITH filtered AS (
  SELECT sc.*
  FROM skill_calls sc
  JOIN sessions s USING (session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND (getvariable('skill') IS NULL OR sc.skill_name = getvariable('skill'))
),
per_skill AS (
  SELECT
    skill_name,
    COUNT(*) as uses,
    COUNT(DISTINCT session_id) as sessions
  FROM filtered
  GROUP BY skill_name
)
SELECT
  skill_name,
  uses,
  sessions,
  (SELECT COUNT(DISTINCT session_id) FROM filtered) as total_sessions,
  (SELECT SUM(uses) FROM per_skill) as total_uses
FROM per_skill
ORDER BY uses DESC, skill_name;
