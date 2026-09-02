-- ---
-- name: search
-- tier: 1
-- summary: >-
--   Find sessions by keyword, matching the session label and the prose of both messages and
--   content items.
-- description: >-
--   ILIKE on the session `label`, `messages.content_text`, and `content_items.text`,
--   returning full `sessions` rows newest first.
-- params:
--   - query
--   - limit
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
SELECT s.*
FROM sessions s
WHERE (
  s.label ILIKE '%' || getvariable('query') || '%'
  OR EXISTS (
    SELECT 1 FROM messages m
    WHERE m.host = s.host AND m.session_id = s.session_id
      AND m.content_text ILIKE '%' || getvariable('query') || '%'
  )
  OR EXISTS (
    SELECT 1 FROM content_items ci
    WHERE ci.host = s.host AND ci.session_id = s.session_id
      AND ci.text ILIKE '%' || getvariable('query') || '%'
  )
)
  AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(s.host, getvariable('host'))
ORDER BY s.start_time DESC
LIMIT getvariable('limit');
