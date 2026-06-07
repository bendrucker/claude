-- Recent tool errors. Rejections of built-in tools that block on user input by design
-- (plan approval, question prompts) are excluded: those rejections are the interaction
-- working, not friction.
-- Params: error_type (`rejection` or `failure`), limit, after_date, before_date,
-- project, host.
SELECT te.*
FROM tool_errors te
JOIN sessions s USING (host, session_id)
WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
  AND (getvariable('error_type') IS NULL OR te.error_type = getvariable('error_type'))
  AND NOT (te.error_type = 'rejection'
       AND te.tool_name IN ('ExitPlanMode', 'AskUserQuestion'))
ORDER BY te.timestamp DESC
LIMIT getvariable('limit');
