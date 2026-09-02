-- ---
-- name: errors
-- tier: 1
-- summary: "Recent tool failures: calls that ran and went wrong."
-- description: >-
--   Denials are a different surface with a different fix, and `permissions` reports them
--   with the mechanism that refused each one, so they are excluded here rather than
--   reported twice under two definitions.
-- params:
--   - limit
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
SELECT te.*
FROM tool_errors te
JOIN sessions s USING (host, session_id)
WHERE date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
  AND te.denial_kind IS NULL
ORDER BY te.timestamp DESC
LIMIT getvariable('limit');
