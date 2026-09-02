-- ---
-- name: sandbox
-- tier: 1
-- summary: >-
--   Bash calls that bypassed the sandbox with `dangerouslyDisableSandbox`, with back-links
--   to prior failed sandboxed calls of the same command.
-- description: >-
--   One row per bypass, most recent first, carrying the command, its description, whether
--   it followed a failure, and the prior error text. The back-link requires the same
--   `agent_id`, so sibling subagents sharing a session id cannot be paired into a retry
--   that never happened.
-- params:
--   - limit
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
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
