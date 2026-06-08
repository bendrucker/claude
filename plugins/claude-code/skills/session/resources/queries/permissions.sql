-- Tool calls the user rejected: the permission-friction surface. Excludes built-in
-- tools that block on user input by design (plan approval, question prompts): a
-- rejection there is the interaction working, not friction a setting can remove.
-- Params: limit, after_date, before_date, project, host.
SELECT
  pr.tool_name,
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
  AND pr.tool_name NOT IN ('ExitPlanMode', 'AskUserQuestion')
ORDER BY pr.timestamp DESC
LIMIT getvariable('limit');
