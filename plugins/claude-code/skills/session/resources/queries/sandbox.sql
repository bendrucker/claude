SELECT
  LEFT(sb.command, 80) as command,
  sb.description,
  sb.retried_tool_id IS NOT NULL as is_retry,
  LEFT(sb.retried_error, 80) as prior_error,
  SPLIT_PART(sb.project_path, '/', -1) as project,
  strftime(sb.timestamp, '%Y-%m-%d %H:%M') as time
FROM sandbox_bypasses sb
JOIN sessions s USING (host, session_id)
WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
ORDER BY sb.timestamp DESC
LIMIT getvariable('limit');
