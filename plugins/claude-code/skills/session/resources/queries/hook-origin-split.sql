-- Split hook wall-clock between portable shared config (CLAUDE_PLUGIN_ROOT/CLAUDE_SKILL_DIR
-- and the symlinked ~/.claude hooks) and arbitrary per-repo project hooks. The central
-- discovery lesson: measure your own config, not a project's `make test-unit`. Per-repo
-- hooks dominating total_s means the latency isn't yours to fix. Hooks run in parallel,
-- so read total_s as aggregate process work, not the wall-clock the user waits on.
-- Params: after_date, before_date, project, host.
WITH ev AS (
  SELECT he.command, he.duration_ms
  FROM hook_events he
  JOIN sessions s USING (host, session_id)
  WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  CASE
    WHEN command LIKE '%CLAUDE_PLUGIN_ROOT%' OR command LIKE '%CLAUDE_SKILL_DIR%'
      OR command LIKE '%/.claude/hooks/%' THEN 'shared_config'
    WHEN command IS NULL THEN 'null'
    ELSE 'project_local'
  END AS origin,
  COUNT(*)                                     AS fires,
  ROUND(SUM(duration_ms) / 1000.0, 1)          AS total_s,
  ROUND(AVG(duration_ms), 0)                   AS avg_ms,
  CAST(quantile_cont(duration_ms, 0.95) AS BIGINT) AS p95_ms
FROM ev
GROUP BY origin
ORDER BY total_s DESC NULLS LAST;
