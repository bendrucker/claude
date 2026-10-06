-- ---
-- name: already-allowed-still-prompting
-- tier: 2
-- dimensions: [permissions-sandbox]
-- summary: >-
--   Bash permission prompts whose command matches a `permissions.allow` pattern you pass
--   as `allow_glob`.
-- description: >-
--   A non-empty result is an allow pattern that is not matching at the prompt, usually a
--   compound command defeating prefix matching. The grounding step compares each row
--   against the live `permissions.allow` list.
-- params:
--   - name: allow_glob
--     meaning: "GLOB on command, required to be useful, e.g. `gh pr *` or `bun *`"
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH pr AS (
  SELECT p.host, p.command, p.session_id, p.timestamp
  FROM permission_requests p
  JOIN sessions s USING (host, session_id)
  WHERE p.tool_name = 'Bash'
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
    AND (getvariable('allow_glob') IS NULL OR p.command GLOB getvariable('allow_glob')::VARCHAR)
)
SELECT
  host,
  command,
  COUNT(*)                   AS prompts,
  COUNT(DISTINCT session_id) AS sessions,
  MIN(timestamp)::DATE       AS first_seen,
  MAX(timestamp)::DATE       AS last_seen
FROM pr
GROUP BY host, command
ORDER BY prompts DESC, host;
