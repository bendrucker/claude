-- ---
-- name: permissions
-- tier: 1
-- summary: >-
--   Denied tool calls, one row per denial, with the mechanism that stopped it and the
--   signal that answered.
-- description: >-
--   `denial_kind` says which mechanism refused the call (`user-rejected`,
--   `permission-rule`, `automode-blocked`, `automode-unavailable`), so hand rejections are
--   separable from the ones a setting produced. `kind_source` is `field` when the harness
--   recorded the kind and `result-string` on rows predating 2026-07-02, where only user
--   rejections leave a trace. Built-in tools that block on user input by design (plan
--   approval, question prompts) are excluded: a rejection there is the interaction working,
--   not friction a setting can remove.
-- params:
--   - name: denial_kind
--     meaning: one kind, or all when unset
--   - limit
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
SELECT
  pr.tool_name,
  pr.denial_kind,
  pr.kind_source,
  COALESCE(
    LEFT(pr.command, 80),
    pr.file_path
  ) as target,
  pr.description,
  SPLIT_PART(pr.project_path, '/', -1) as project,
  strftime(pr.timestamp, '%Y-%m-%d %H:%M') as time
FROM permission_requests pr
JOIN sessions s USING (host, session_id)
WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
  AND (getvariable('denial_kind') IS NULL OR pr.denial_kind = getvariable('denial_kind'))
  AND pr.tool_name NOT IN ('ExitPlanMode', 'AskUserQuestion')
ORDER BY pr.timestamp DESC
LIMIT getvariable('limit');
