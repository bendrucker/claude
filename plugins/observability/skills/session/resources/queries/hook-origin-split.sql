-- ---
-- name: hook-origin-split
-- tier: 2
-- dimensions: [hook-latency]
-- summary: >-
--   Hook wall-clock split between portable shared config and arbitrary per-repo project
--   hooks.
-- description: >-
--   The central discovery lesson: measure your own config, not a project's `make
--   test-unit`. Per-repo hooks dominating `total_s` means the latency is not yours to fix.
--   `shared_config` is what travels with you, plugin and skill hooks (`CLAUDE_PLUGIN_ROOT`,
--   `CLAUDE_SKILL_DIR`) plus the user-level hook dir under `$HOME`. A `.claude/hooks/` path
--   rooted at `CLAUDE_PROJECT_DIR` is a per-repo hook that happens to share the directory
--   name, so it belongs to `project_local`. Hooks run in parallel, so read `total_s` as
--   aggregate process work rather than the wall-clock the user waits on.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
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
    WHEN command IS NULL THEN 'null'
    WHEN command LIKE '%CLAUDE_PLUGIN_ROOT%' OR command LIKE '%CLAUDE_SKILL_DIR%'
      OR command LIKE '%$HOME/.claude/hooks/%' OR command LIKE '%~/.claude/hooks/%'
      THEN 'shared_config'
    ELSE 'project_local'
  END AS origin,
  COUNT(*)                                     AS fires,
  ROUND(SUM(duration_ms) / 1000.0, 1)          AS total_s,
  ROUND(AVG(duration_ms), 0)                   AS avg_ms,
  CAST(quantile_cont(duration_ms, 0.95) AS BIGINT) AS p95_ms
FROM ev
GROUP BY origin
ORDER BY total_s DESC NULLS LAST;
