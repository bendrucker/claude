-- Per skill, how invocations split between model-auto (the model chose to load it, empty
-- args) and explicit slash/args calls. A skill invoked only explicitly can go
-- `disable-model-invocation` and stop paying for its always-on description; one invoked
-- mostly model-auto is earning that description. The core skill-economy lever.
-- `args` is already NULL when empty (the skill_calls view applies NULLIF), so model-auto
-- is `args IS NULL`.
-- Params: after_date, before_date, project, host, min_calls (floor on total, default 1).
WITH sc AS (
  SELECT c.*
  FROM skill_calls c
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  skill_name,
  COUNT(*) FILTER (WHERE args IS NULL)     AS model_auto,
  COUNT(*) FILTER (WHERE args IS NOT NULL)  AS explicit_args,
  COUNT(*)                                  AS total
FROM sc
GROUP BY skill_name
HAVING COUNT(*) >= COALESCE(getvariable('min_calls'), 1)
ORDER BY total DESC, skill_name;
